import { Injectable } from '@nestjs/common';
import { Currency } from '@/domain/currency';
import { Transaction } from '@/domain/transaction';

export abstract class TransactionsRepository {
  abstract findById(id: string): Transaction | undefined;
  abstract findAll(): Transaction[];
  abstract save(transaction: Transaction): Transaction;
}

@Injectable()
export class InMemoryTransactionsRepository extends TransactionsRepository {
  private readonly transactions = new Map<string, Transaction>();

  constructor() {
    super();
    this.seed();
  }

  findById(id: string): Transaction | undefined {
    return this.transactions.get(id);
  }

  findAll(): Transaction[] {
    return [...this.transactions.values()];
  }

  save(transaction: Transaction): Transaction {
    this.transactions.set(transaction.id, transaction);
    return transaction;
  }

  private seed(): void {
    this.transactions.clear();
    for (const tx of [
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        account_id: '11111111-1111-4111-8111-111111111111',
        type: 'expense' as const,
        amount_cents: 4599,
        currency: Currency.UAH,
        occurred_at: '2026-08-20T12:30:00.000Z',
        description: 'Кава і сніданок',
        instrument_symbol: null,
        quantity_micro: null,
        created_at: '2026-08-20T12:31:00.000Z',
      },
      {
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        account_id: '22222222-2222-4222-8222-222222222222',
        type: 'buy' as const,
        amount_cents: 520000,
        currency: Currency.USD,
        occurred_at: '2026-08-21T14:00:00.000Z',
        description: 'Купівля 10 акцій VOO',
        instrument_symbol: 'VOO',
        quantity_micro: 10000000,
        created_at: '2026-08-21T14:00:05.000Z',
      },
    ]) {
      this.transactions.set(tx.id, tx);
    }
  }
}
