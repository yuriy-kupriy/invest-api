import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account as AccountEntity } from '@/entities/account.entity';
import { Account, AccountType } from '@/domain/account';
import { Currency } from '@/domain/currency';

/**
 * Accounts created through this API attach to a fixed system user: the HW #9
 * domain type has no concept of "who owns this account" (it predates the HW
 * #12 schema's `users` table), while `accounts.user_id` is NOT NULL. The seed
 * script (src/seed.ts) creates this exact user, so it must have run first.
 */
const SEED_OWNER_USER_ID = '00000001-0000-4000-8000-000000000001';

function toDomain(entity: AccountEntity): Account {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    currency: entity.currency as Currency,
    balance_cents: entity.balanceCents,
    created_at: entity.createdAt.toISOString(),
  };
}

@Injectable()
export class AccountsRepository {
  constructor(@InjectRepository(AccountEntity) private readonly repo: Repository<AccountEntity>) {}

  async findById(id: string): Promise<Account | undefined> {
    const entity = await this.repo.findOne({ where: { id } });
    return entity ? toDomain(entity) : undefined;
  }

  async findAll(): Promise<Account[]> {
    const entities = await this.repo.find();
    return entities.map(toDomain);
  }

  async save(account: Account): Promise<Account> {
    const entity = this.repo.create({
      id: account.id,
      userId: SEED_OWNER_USER_ID,
      currency: account.currency,
      name: account.name,
      type: account.type as AccountType,
      balanceCents: account.balance_cents,
      isArchived: false,
    });
    await this.repo.save(entity);
    return account;
  }

  async updateBalance(id: string, delta: number): Promise<void> {
    await this.repo.increment({ id }, 'balanceCents', delta);
  }

  async has(id: string): Promise<boolean> {
    return this.repo.exists({ where: { id } });
  }
}
