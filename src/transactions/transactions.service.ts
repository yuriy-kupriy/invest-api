import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountsRepository } from '@/accounts/accounts.repository';
import {
  Transaction,
  TransactionBatch,
  TransactionPage,
  TransactionResponse,
  TransactionType,
} from '@/domain/transaction';
import { toTransaction } from '@/shared/mappers';
import { paginate } from '@/shared/pagination';
import { problem } from '@/shared/problem.exception';
import { CreateTransactionsDto } from './dto/create-transactions.dto';
import { TransactionsRepository } from './transactions.repository';

const SIGN: Record<TransactionType, 1 | -1> = {
  income: 1,
  transfer_in: 1,
  sell: 1,
  expense: -1,
  transfer_out: -1,
  buy: -1,
};

@Injectable()
export class TransactionsService {
  constructor(
    private readonly transactionsRepo: TransactionsRepository,
    private readonly accountsRepo: AccountsRepository,
  ) {}

  list(limit: number, cursor?: string, accountId?: string): TransactionPage {
    if (accountId && !this.accountsRepo.has(accountId)) {
      throw problem(HttpStatus.NOT_FOUND, 'account-not-found', `рахунок ${accountId} не знайдено`);
    }

    const rows = this.transactionsRepo
      .findAll()
      .filter((tx) => !accountId || tx.account_id === accountId);
    const page = paginate(rows, (tx) => tx.occurred_at, limit, cursor);
    return {
      items: page.items.map(toTransaction),
      next_cursor: page.next_cursor,
    };
  }

  create(input: CreateTransactionsDto): TransactionBatch {
    const now = new Date().toISOString();
    const created: Transaction[] = [];
    const deltas = new Map<string, number>();

    for (const entry of input.entries) {
      const account = this.accountsRepo.findById(entry.account_id);
      if (!account) {
        throw problem(
          HttpStatus.NOT_FOUND,
          'account-not-found',
          `рахунок ${entry.account_id} не знайдено`,
        );
      }
      if (account.currency !== entry.currency) {
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'currency-mismatch',
          `валюта ${entry.currency} не збігається з валютою рахунку ${account.id} (${account.currency})`,
        );
      }

      created.push({
        id: randomUUID(),
        account_id: entry.account_id,
        type: entry.type,
        amount_cents: entry.amount_cents,
        currency: entry.currency,
        occurred_at: entry.occurred_at,
        description: entry.description ?? null,
        instrument_symbol: entry.instrument_symbol ?? null,
        quantity_micro: entry.quantity_micro ?? null,
        created_at: now,
      });
      deltas.set(
        entry.account_id,
        (deltas.get(entry.account_id) ?? 0) + SIGN[entry.type] * entry.amount_cents,
      );
    }

    for (const tx of created) {
      this.transactionsRepo.save(tx);
    }
    for (const [id, delta] of deltas) {
      this.accountsRepo.updateBalance(id, delta);
    }

    return { transactions: created.map(toTransaction) };
  }

  getById(transactionId: string): TransactionResponse {
    const tx = this.transactionsRepo.findById(transactionId);
    if (!tx) {
      throw problem(
        HttpStatus.NOT_FOUND,
        'transaction-not-found',
        `транзакцію ${transactionId} не знайдено`,
      );
    }
    return toTransaction(tx);
  }
}
