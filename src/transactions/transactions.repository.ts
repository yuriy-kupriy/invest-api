import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { FxRatesService } from '@/fx-rates/fx-rates.service';
import { Currency } from '@/domain/currency';
import { Transaction, TransactionType } from '@/domain/transaction';
import { CursorPayload } from '@/shared/pagination';

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

  async save(transaction: Transaction, manager?: EntityManager): Promise<Transaction> {
    const repo = this.repoFor(manager);
    const instruments = manager ? manager.getRepository(Instrument) : this.instrumentsRepo;
    const bookedAt = new Date(transaction.booked_at);

    const [instrument, fxRate] = await Promise.all([
      transaction.instrument_symbol
        ? instruments.findOne({ where: { symbol: transaction.instrument_symbol } })
        : null,
      this.fxRatesService.getEffectiveRate(transaction.currency, bookedAt, manager),
    ]);

    const entity = repo.create({
      id: transaction.id,
      accountId: transaction.account_id,
      instrumentId: instrument?.id ?? null,
      categoryId: null,
      currency: transaction.currency,
      type: transaction.type as TransactionType,
      status: 'posted',
      amountCents: transaction.amount_cents,
      fxRate,
      quantityMicro: transaction.quantity_micro,
      unitPrice: null,
      bookedAt,
      description: transaction.description,
    });
    await repo.save(entity);
    return transaction;
  }
}
