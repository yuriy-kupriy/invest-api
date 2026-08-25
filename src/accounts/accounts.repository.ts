import { Injectable } from '@nestjs/common';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';

export abstract class AccountsRepository {
  abstract findById(id: string): Account | undefined;
  abstract findAll(): Account[];
  abstract save(account: Account): Account;
  abstract updateBalance(id: string, delta: number): void;
  abstract has(id: string): boolean;
}

@Injectable()
export class InMemoryAccountsRepository extends AccountsRepository {
  private readonly accounts = new Map<string, Account>();

  constructor() {
    super();
    this.seed();
  }

  findById(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  findAll(): Account[] {
    return [...this.accounts.values()];
  }

  save(account: Account): Account {
    this.accounts.set(account.id, account);
    return account;
  }

  updateBalance(id: string, delta: number): void {
    const account = this.accounts.get(id);
    if (!account) {
      return;
    }
    account.balance_cents += delta;
  }

  has(id: string): boolean {
    return this.accounts.has(id);
  }

  private seed(): void {
    this.accounts.clear();
    for (const account of [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Готівка UAH',
        type: 'cash' as const,
        currency: Currency.UAH,
        balance_cents: 350000,
        created_at: '2026-01-10T09:00:00.000Z',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Брокерський IBKR',
        type: 'brokerage' as const,
        currency: Currency.USD,
        balance_cents: 1250000,
        created_at: '2026-02-01T09:00:00.000Z',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Квартира на Печерську',
        type: 'property' as const,
        currency: Currency.USD,
        balance_cents: 9500000,
        created_at: '2026-02-15T09:00:00.000Z',
      },
    ]) {
      this.accounts.set(account.id, account);
    }
  }
}
