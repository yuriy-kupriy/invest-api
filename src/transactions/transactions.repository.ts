import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { FxRatesService } from '@/fx-rates/fx-rates.service';
import { Currency } from '@/domain/currency';
import { Transaction, TransactionType } from '@/domain/transaction';

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

  async findById(id: string): Promise<Transaction | undefined> {
    const entity = await this.repo.findOne({ where: { id }, relations: { instrument: true } });
    return entity ? toDomain(entity) : undefined;
  }

  async findAll(): Promise<Transaction[]> {
    const entities = await this.repo.find({ relations: { instrument: true } });
    return entities.map(toDomain);
  }

  async save(transaction: Transaction): Promise<Transaction> {
    const bookedAt = new Date(transaction.booked_at);
    const [instrument, fxRate] = await Promise.all([
      transaction.instrument_symbol
        ? this.instrumentsRepo.findOne({ where: { symbol: transaction.instrument_symbol } })
        : null,
      this.fxRatesService.getEffectiveRate(transaction.currency, bookedAt),
    ]);

    const entity = this.repo.create({
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
    await this.repo.save(entity);
    return transaction;
  }
}
