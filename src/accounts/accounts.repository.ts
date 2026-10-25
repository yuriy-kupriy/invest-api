import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Account as AccountEntity } from '@/entities/account.entity';
import { Account, AccountType, OwnedAccount } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { CursorPayload } from '@/shared/pagination';

function toDomain(entity: AccountEntity): OwnedAccount {
  return {
    id: entity.id,
    user_id: entity.userId,
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

  async findById(id: string, manager?: EntityManager): Promise<OwnedAccount | undefined> {
    const entity = await this.repoFor(manager).findOne({ where: { id } });
    return entity ? toDomain(entity) : undefined;
  }

  /**
   * Batched form of `findById`: a create-transactions batch of up to 100
   * entries can repeat the same account_id, so this resolves the whole batch
   * with one `WHERE id IN (...)` instead of one SELECT per entry.
   */
  async findByIds(ids: string[], manager?: EntityManager): Promise<OwnedAccount[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.repoFor(manager).find({ where: { id: In(ids) } });
    return entities.map(toDomain);
  }

  /**
   * Keyset page of ONE user's accounts, ordered by (created_at DESC, id DESC).
   * Ownership of a list is a WHERE, not a check after loading: foreign rows
   * never leave the database. `userId` comes first so no caller can forget it.
   */
  async findPage(userId: string, limit: number, cursor?: CursorPayload): Promise<OwnedAccount[]> {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .orderBy('a.createdAt', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .take(limit);

    if (cursor) {
      qb.andWhere('(a.createdAt, a.id) < (:c, :cid)', { c: cursor.c, cid: cursor.id });
    }

    const entities = await qb.getMany();
    return entities.map(toDomain);
  }

  async save(account: Account, userId: string, manager?: EntityManager): Promise<Account> {
    const repo = this.repoFor(manager);
    const entity = repo.create({
      id: account.id,
      userId,
      currency: account.currency,
      name: account.name,
      type: account.type as AccountType,
      balanceCents: account.balance_cents,
      isArchived: false,
      // Same reason as TransactionsRepository.saveMany: store the created_at
      // the service returns, not a second now() taken by Postgres.
      createdAt: new Date(account.created_at),
    });
    await repo.save(entity);
    return account;
  }

  async updateBalance(id: string, delta: number, manager?: EntityManager): Promise<void> {
    await this.repoFor(manager).increment({ id }, 'balanceCents', delta);
  }
}
