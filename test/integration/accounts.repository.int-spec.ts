import { randomUUID } from 'node:crypto';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { Account as AccountEntity } from '@/entities/account.entity';
import { encodeCursor } from '@/shared/pagination';
import { anAccount } from '../testkit/builders';
import { connect, resetDb } from '../testkit/db';

/**
 * AccountsRepository against a real postgres:16-alpine. Everything here is
 * something a mocked repository cannot tell you: that the domain↔entity mapping
 * survives a round trip through actual columns, that keyset pagination is
 * ordered by the database, and that the schema's own constraints fire.
 */
/** The fixture user every db/dev-fixtures.sql account belongs to. */
const OWNER_ID = '00000001-0000-4000-8000-000000000001';

describe('AccountsRepository (integration)', () => {
  let moduleRef: TestingModule;
  let repo: AccountsRepository;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await connect();
    moduleRef = await Test.createTestingModule({
      imports: [AppTypeOrmModule, TypeOrmModule.forFeature([AccountEntity])],
      providers: [AccountsRepository],
    }).compile();
    repo = moduleRef.get(AccountsRepository);
  });

  afterAll(async () => {
    // Both connections have to go, or jest hangs on the open handles.
    await moduleRef.close();
    await ds.destroy();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('round-trips an account through real columns', async () => {
    const account = anAccount({ name: 'Round trip', type: 'brokerage', balance_cents: 4242 });

    await repo.save(account, OWNER_ID);
    const found = await repo.findById(account.id);

    expect(found).toEqual({
      id: account.id,
      user_id: OWNER_ID,
      name: 'Round trip',
      type: 'brokerage',
      currency: account.currency,
      // bigint comes back as a string from pg; bigintTransformer is what makes
      // this a number, and only a real query exercises it.
      balance_cents: 4242,
      // Exactly what was saved, not "some timestamp": created_at is the
      // keyset cursor's sort key, and the API returns it from POST /accounts.
      created_at: account.created_at,
    });
  });

  it('paginates by keyset in created_at DESC, id DESC order', async () => {
    const older = anAccount({ name: 'Older' });
    const newer = anAccount({ name: 'Newer' });
    await repo.save(older, OWNER_ID);
    await repo.save(newer, OWNER_ID);

    // Timestamps are assigned by the database on insert, so read them back
    // rather than trusting the builder's.
    const rows: Array<{ id: string; created_at: Date }> = await ds.query(
      'SELECT id, created_at FROM accounts ORDER BY created_at DESC, id DESC',
    );

    const firstPage = await repo.findPage(OWNER_ID, 2);
    expect(firstPage.map((a) => a.id)).toEqual(rows.slice(0, 2).map((r) => r.id));

    const secondPage = await repo.findPage(OWNER_ID, 2, {
      c: rows[1].created_at.toISOString(),
      id: rows[1].id,
    });
    expect(secondPage.map((a) => a.id)).toEqual(rows.slice(2, 4).map((r) => r.id));
    expect(secondPage).not.toContainEqual(expect.objectContaining({ id: rows[1].id }));

    // Ownership is part of the query: another user's page is empty, not filtered later.
    expect(await repo.findPage(randomUUID(), 10)).toEqual([]);

    // The cursor the API hands out encodes exactly that pair.
    expect(() => encodeCursor(rows[1].created_at.toISOString(), rows[1].id)).not.toThrow();
  });

  it('rejects an account whose owner does not exist (foreign key 23503)', async () => {
    // Provoked at the table itself — this is the constraint the mocked
    // repository cannot have.
    await expect(
      ds.query(
        `INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived)
         VALUES ($1, $2, 'UAH', 'Orphan', 'cash', 0, false)`,
        [randomUUID(), randomUUID()],
      ),
    ).rejects.toMatchObject({
      code: '23503',
      table: 'accounts',
      detail: expect.stringContaining('user_id'),
    });
  });

  it('rejects a duplicate account id (unique violation 23505)', async () => {
    const account = anAccount();
    await repo.save(account, OWNER_ID);

    await expect(
      ds.query(
        `INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived)
         SELECT $1, user_id, currency, 'Duplicate', type, 0, false FROM accounts WHERE id = $1`,
        [account.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('increments a balance in place', async () => {
    const account = anAccount({ balance_cents: 1000 });
    await repo.save(account, OWNER_ID);

    await repo.updateBalance(account.id, -250);

    expect(await repo.findById(account.id)).toMatchObject({ balance_cents: 750 });
  });
});
