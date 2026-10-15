import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '@/auth/auth.types';
import { assertOwner } from '@/auth/ownership';
import { Account, AccountPage } from '@/domain/account';
import { toAccount } from '@/shared/mappers';
import { decodeCursor, encodeCursor } from '@/shared/pagination';
import { problem } from '@/shared/problem.exception';
import { AccountsRepository } from './accounts.repository';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly accountsRepo: AccountsRepository) {}

  async list(user: AuthUser, limit: number, cursor?: string): Promise<AccountPage> {
    const rows = await this.accountsRepo.findPage(user.id, limit, cursor ? decodeCursor(cursor) : undefined);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(toAccount),
      next_cursor: rows.length === limit && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async create(input: CreateAccountDto, user: AuthUser): Promise<Account> {
    const account: Account = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      currency: input.currency,
      balance_cents: input.opening_balance_cents,
      created_at: new Date().toISOString(),
    };
    await this.accountsRepo.save(account, user.id);
    return toAccount(account);
  }

  /** Loaded first, then compared: 404 for no such row, 403 for someone else's. */
  async getById(accountId: string, user: AuthUser): Promise<Account> {
    const account = await this.accountsRepo.findById(accountId);
    if (!account) {
      throw problem(HttpStatus.NOT_FOUND, 'account-not-found', `account ${accountId} was not found`);
    }
    assertOwner(account.user_id, user, `account ${accountId}`);
    return toAccount(account);
  }
}
