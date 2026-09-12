import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { Currency } from '@/domain/currency';
import { Transaction, TransactionType } from '@/domain/transaction';
import { TransactionsRepository } from './transactions.repository';

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

/**
 * The HW #9 domain snapshots no fx rate (it predates the HW #12 fx_rate
 * table), while `transactions.fx_rate` is NOT NULL and CHECKs
 * `(currency = 'UAH') = (fx_rate = 1)`. This is a placeholder rate for
 * non-UAH currencies until the domain type carries a real one.
 */
const PLACEHOLDER_FX_RATE: Record<string, string> = { UAH: '1', USD: '41.5', EUR: '45.0' };

@Injectable()
export class TypeOrmTransactionsRepository extends TransactionsRepository {
  constructor(
    @InjectRepository(TransactionEntity) private readonly repo: Repository<TransactionEntity>,
    @InjectRepository(Instrument) private readonly instrumentsRepo: Repository<Instrument>,
  ) {
    super();
  }

  async findById(id: string): Promise<Transaction | undefined> {
    const entity = await this.repo.findOne({ where: { id }, relations: { instrument: true } });
    return entity ? toDomain(entity) : undefined;
  }

  async findAll(): Promise<Transaction[]> {
    const entities = await this.repo.find({ relations: { instrument: true } });
    return entities.map(toDomain);
  }

  async save(transaction: Transaction): Promise<Transaction> {
    const instrument = transaction.instrument_symbol
      ? await this.instrumentsRepo.findOne({ where: { symbol: transaction.instrument_symbol } })
      : null;

    const entity = this.repo.create({
      id: transaction.id,
      accountId: transaction.account_id,
      instrumentId: instrument?.id ?? null,
      categoryId: null,
      currency: transaction.currency,
      type: transaction.type as TransactionType,
      status: 'posted',
      amountCents: transaction.amount_cents,
      fxRate: PLACEHOLDER_FX_RATE[transaction.currency] ?? '1',
      quantityMicro: transaction.quantity_micro,
      unitPrice: null,
      bookedAt: new Date(transaction.booked_at),
      description: transaction.description,
    });
    await this.repo.save(entity);
    return transaction;
  }
}
