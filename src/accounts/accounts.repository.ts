import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Account as AccountEntity } from '@/entities/account.entity';
import { Account, AccountType } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { CursorPayload } from '@/shared/pagination';

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

  /**
   * Every method takes an optional EntityManager so a caller that opened a
   * transaction (TransactionsService.create) can run inside it instead of on a
   * separate autocommitted connection.
   */
  private repoFor(manager?: EntityManager): Repository<AccountEntity> {
    return manager ? manager.getRepository(AccountEntity) : this.repo;
  }

  async findById(id: string, manager?: EntityManager): Promise<Account | undefined> {
    const entity = await this.repoFor(manager).findOne({ where: { id } });
    return entity ? toDomain(entity) : undefined;
  }

  /**
   * Batched form of `findById`: a create-transactions batch of up to 100
   * entries can repeat the same account_id, so this resolves the whole batch
   * with one `WHERE id IN (...)` instead of one SELECT per entry.
   */
  async findByIds(ids: string[], manager?: EntityManager): Promise<Account[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.repoFor(manager).find({ where: { id: In(ids) } });
    return entities.map(toDomain);
  }

  /** Keyset page ordered by (created_at DESC, id DESC) — the cursor's sort key is created_at. */
  async findPage(limit: number, cursor?: CursorPayload): Promise<Account[]> {
    const qb = this.repo
      .createQueryBuilder('a')
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(limit);

    if (cursor) {
      qb.andWhere('(a.createdAt, a.id) < (:c, :cid)', { c: cursor.c, cid: cursor.id });
    }

    const entities = await qb.getMany();
    return entities.map(toDomain);
  }

  async save(account: Account, manager?: EntityManager): Promise<Account> {
    const repo = this.repoFor(manager);
    const entity = repo.create({
      id: account.id,
      userId: SEED_OWNER_USER_ID,
      currency: account.currency,
      name: account.name,
      type: account.type as AccountType,
      balanceCents: account.balance_cents,
      isArchived: false,
    });
    await repo.save(entity);
    return account;
  }

  async updateBalance(id: string, delta: number, manager?: EntityManager): Promise<void> {
    await this.repoFor(manager).increment({ id }, 'balanceCents', delta);
  }

  async has(id: string, manager?: EntityManager): Promise<boolean> {
    return this.repoFor(manager).exists({ where: { id } });
  }
}
