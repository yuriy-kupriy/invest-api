import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Account, AccountPage } from '@/domain/account';
import { toAccount } from '@/shared/mappers';
import { paginate } from '@/shared/pagination';
import { problem } from '@/shared/problem.exception';
import { AccountsRepository } from './accounts.repository';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly accountsRepo: AccountsRepository) {}

  list(limit: number, cursor?: string): AccountPage {
    const page = paginate(this.accountsRepo.findAll(), (account) => account.created_at, limit, cursor);
    return {
      items: page.items.map(toAccount),
      next_cursor: page.next_cursor,
    };
  }

  create(input: CreateAccountDto): Account {
    const account: Account = {
      id: randomUUID(),
      name: input.name,
      type: input.type,
      currency: input.currency,
      balance_cents: input.opening_balance_cents,
      created_at: new Date().toISOString(),
    };
    this.accountsRepo.save(account);
    return toAccount(account);
  }

  getById(accountId: string): Account {
    const account = this.accountsRepo.findById(accountId);
    if (!account) {
      throw problem(HttpStatus.NOT_FOUND, 'account-not-found', `account ${accountId} was not found`);
    }
    return toAccount(account);
  }
}
