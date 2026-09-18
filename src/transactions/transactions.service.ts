import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { Env } from '@/config/env.schema';
import {
  Transaction,
  TransactionBatch,
  TransactionPage,
  TransactionResponse,
  TransactionType,
} from '@/domain/transaction';
import { toTransaction } from '@/shared/mappers';
import { decodeCursor, encodeCursor } from '@/shared/pagination';
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
  /** Read once from the validated config — see toTransaction(). */
  private readonly drift: boolean;

  constructor(
    private readonly transactionsRepo: TransactionsRepository,
    private readonly accountsRepo: AccountsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.drift = config.get('DRIFT', { infer: true }) === '1';
  }

  /**
   * Arrow field so it can be handed straight to `.map` — and so no call site can
   * forget to thread `drift` through, which the bare mapper's default would hide.
   */
  private readonly toWire = (tx: Transaction): TransactionResponse => toTransaction(tx, this.drift);

  async list(limit: number, cursor?: string, accountId?: string): Promise<TransactionPage> {
    if (accountId && !(await this.accountsRepo.has(accountId))) {
      throw problem(HttpStatus.NOT_FOUND, 'account-not-found', `account ${accountId} was not found`);
    }

    const rows = await this.transactionsRepo.findPage(
      limit,
      cursor ? decodeCursor(cursor) : undefined,
      accountId,
    );
    const last = rows[rows.length - 1];
    return {
      items: rows.map(this.toWire),
      next_cursor: rows.length === limit && last ? encodeCursor(last.booked_at, last.id) : null,
    };
  }

  /**
   * The whole batch — validation reads, every insert, every balance update —
   * runs inside one DB transaction, which is what makes the "either every
   * entries row is created, or none" promise in openapi.yaml true. Validation
   * is inside it too, so an account cannot be deleted between the check and
   * the insert. Any ProblemException thrown in the callback rolls the whole
   * thing back and propagates unchanged.
   *
   * Accounts are resolved once for the whole batch (`findByIds`) instead of
   * once per entry — a batch of up to 100 entries commonly repeats the same
   * few account_ids — and the write side (`saveMany`) resolves instrument
   * symbols and fx rates per unique value across the batch, not per entry.
   */
  async create(input: CreateTransactionsDto): Promise<TransactionBatch> {
    const now = new Date().toISOString();

    const created = await this.dataSource.transaction(async (manager) => {
      const accountIds = [...new Set(input.entries.map((entry) => entry.account_id))];
      const accountById = new Map(
        (await this.accountsRepo.findByIds(accountIds, manager)).map((account) => [account.id, account]),
      );

      const batch: Transaction[] = [];
      const deltas = new Map<string, number>();

      for (const entry of input.entries) {
        const account = accountById.get(entry.account_id);
        if (!account) {
          throw problem(
            HttpStatus.NOT_FOUND,
            'account-not-found',
            `account ${entry.account_id} was not found`,
          );
        }
        if (account.currency !== entry.currency) {
          throw problem(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'currency-mismatch',
            `currency ${entry.currency} does not match the currency of account ${account.id} (${account.currency})`,
          );
        }
        // Mirrors the transactions_instrument_matches_type CHECK. Without this
        // the constraint still catches it, but as a 500 with a raw Postgres
        // constraint name instead of a 422 naming the offending entry.
        const needsInstrument = entry.type === 'buy' || entry.type === 'sell';
        if (needsInstrument !== Boolean(entry.instrument_symbol)) {
          throw problem(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'instrument-type-mismatch',
            needsInstrument
              ? `type ${entry.type} requires instrument_symbol`
              : `instrument_symbol is only valid for buy and sell, not ${entry.type}`,
          );
        }

        batch.push({
          id: randomUUID(),
          account_id: entry.account_id,
          type: entry.type,
          amount_cents: entry.amount_cents,
          currency: entry.currency,
          booked_at: entry.booked_at,
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

      await this.transactionsRepo.saveMany(batch, manager);
      for (const [id, delta] of deltas) {
        await this.accountsRepo.updateBalance(id, delta, manager);
      }

      return batch;
    });

    return { transactions: created.map(this.toWire) };
  }

  async getById(transactionId: string): Promise<TransactionResponse> {
    const tx = await this.transactionsRepo.findById(transactionId);
    if (!tx) {
      throw problem(
        HttpStatus.NOT_FOUND,
        'transaction-not-found',
        `transaction ${transactionId} was not found`,
      );
    }
    return this.toWire(tx);
  }
}
