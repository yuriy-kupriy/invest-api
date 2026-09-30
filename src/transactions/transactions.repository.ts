import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { fxRateKey } from '@/fx-rates/fx-rate.repository';
import { FxRatesService } from '@/fx-rates/fx-rates.service';
import { Currency } from '@/domain/currency';
import { Transaction, TransactionType } from '@/domain/transaction';
import { CursorPayload } from '@/shared/pagination';
import { problem } from '@/shared/problem.exception';

function toDomain(entity: TransactionEntity): Transaction {
  return {
    id: entity.id,
    account_id: entity.accountId,
    type: entity.type,
    amount_cents: entity.amountCents,
    currency: entity.currency as Currency,
    created_at: entity.createdAt.toISOString(),
    booked_at: entity.bookedAt.toISOString(),
    description: entity.description,
    quantity_micro: entity.quantityMicro,
    instrument_symbol: entity.instrument?.symbol ?? null,
  };
}

@Injectable()
export class TransactionsRepository {
  constructor(
    @InjectRepository(TransactionEntity) private readonly repo: Repository<TransactionEntity>,
    @InjectRepository(Instrument) private readonly instrumentsRepo: Repository<Instrument>,
    private readonly fxRatesService: FxRatesService,
  ) {}

  /**
   * Every method takes an optional EntityManager so a caller that opened a
   * transaction (TransactionsService.create) can run inside it instead of on a
   * separate autocommitted connection.
   */
  private repoFor(manager?: EntityManager): Repository<TransactionEntity> {
    return manager ? manager.getRepository(TransactionEntity) : this.repo;
  }

  async findById(id: string, manager?: EntityManager): Promise<Transaction | undefined> {
    const entity = await this.repoFor(manager).findOne({
      where: { id },
      relations: { instrument: true },
    });
    return entity ? toDomain(entity) : undefined;
  }

  /**
   * Keyset page ordered by (booked_at DESC, id DESC), optionally narrowed to
   * one account. The row-value comparison is exactly the shape
   * `transactions_account_booked_idx (account_id, booked_at DESC, id DESC)`
   * was built for, so this is an index scan rather than a full read.
   */
  async findPage(limit: number, cursor?: CursorPayload, accountId?: string): Promise<Transaction[]> {
    const qb = this.repo
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.instrument', 'instrument')
      .orderBy('t.bookedAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .take(limit);

    if (accountId) {
      qb.andWhere('t.accountId = :accountId', { accountId });
    }
    if (cursor) {
      qb.andWhere('(t.bookedAt, t.id) < (:c, :cid)', { c: cursor.c, cid: cursor.id });
    }

    const entities = await qb.getMany();
    return entities.map(toDomain);
  }

  /**
   * Bulk write for a create-transactions batch (up to 100 entries). Where the
   * old per-row `save()` did, per transaction, one instrument lookup + one fx
   * rate lookup + one INSERT — up to 3N round trips for N entries, most of
   * them repeating the same instrument symbol or the same (currency, date)
   * pair — this resolves both lookups once per unique value across the whole
   * batch and inserts every row in one multi-row INSERT.
   */
  async saveMany(transactions: Transaction[], manager: EntityManager): Promise<Transaction[]> {
    if (transactions.length === 0) {
      return transactions;
    }

    const instruments = manager.getRepository(Instrument);
    const symbols = [
      ...new Set(
        transactions
          .map((tx) => tx.instrument_symbol)
          .filter((symbol): symbol is string => symbol !== null),
      ),
    ];
    const instrumentRows = symbols.length
      ? await instruments.find({ where: { symbol: In(symbols) } })
      : [];
    const instrumentIdBySymbol = new Map(instrumentRows.map((i) => [i.symbol, i.id]));

    // A symbol that doesn't resolve (typo, or lower case — the lookup is
    // case-sensitive and the column CHECK requires upper) must be reported as
    // the client error it is. Left to fall through as a NULL instrument_id it
    // would instead trip transactions_instrument_matches_type and surface as a
    // 500 quoting the constraint name.
    const unknown = symbols.filter((symbol) => !instrumentIdBySymbol.has(symbol));
    if (unknown.length > 0) {
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'instrument-not-found',
        `unknown instrument_symbol: ${unknown.join(', ')}`,
      );
    }

    const fxRateByKey = await this.fxRatesService.getEffectiveRates(
      transactions.map((tx) => ({ currency: tx.currency, on: new Date(tx.booked_at) })),
      manager,
    );

    const rows = transactions.map((tx) => {
      const bookedAt = new Date(tx.booked_at);
      return {
        id: tx.id,
        accountId: tx.account_id,
        instrumentId: tx.instrument_symbol ? instrumentIdBySymbol.get(tx.instrument_symbol) ?? null : null,
        categoryId: null,
        currency: tx.currency,
        type: tx.type as TransactionType,
        status: 'posted' as const,
        amountCents: tx.amount_cents,
        fxRate: fxRateByKey.get(fxRateKey(tx.currency, bookedAt)),
        quantityMicro: tx.quantity_micro,
        unitPrice: null,
        bookedAt,
        description: tx.description,
        // Persist the timestamp the service already put in the response. Left
        // to @CreateDateColumn, Postgres stamps its own now() a few ms later
        // and the 201 body disagrees with every later GET of the same row.
        createdAt: new Date(tx.created_at),
      };
    });

    await this.repoFor(manager).createQueryBuilder().insert().into(TransactionEntity).values(rows).execute();

    return transactions;
  }
}
