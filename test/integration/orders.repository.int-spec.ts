import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OrdersRepository } from '@/orders/orders.repository';
import { connect, resetDb } from '../testkit/db';

const BROKERAGE_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const BUY_ID = 'aaaaaaaa-0000-4000-8000-000000000002'; // fixture: posted buy, 520000
const EXPENSE_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

/**
 * The money rules of PATCH /orders/{id}/status live in SQL and in Postgres's
 * locking — a mocked repository cannot reach either.
 */
describe('OrdersRepository (integration)', () => {
  let ds: DataSource;
  let repo: OrdersRepository;

  const balance = async (): Promise<number> =>
    Number((await ds.query(`SELECT balance_cents FROM accounts WHERE id = $1`, [BROKERAGE_ACCOUNT_ID]))[0].balance_cents);

  beforeAll(async () => {
    ds = await connect();
    repo = new OrdersRepository(ds);
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('credits a balance that is already below zero, but refuses an uncovered debit', async () => {
    await ds.query(`UPDATE accounts SET balance_cents = -30000 WHERE id = $1`, [BROKERAGE_ACCOUNT_ID]);

    expect(await ds.transaction((m) => repo.applyBalanceDelta(BROKERAGE_ACCOUNT_ID, 20000, m))).toBe(true);
    expect(await balance()).toBe(-10000);

    expect(await ds.transaction((m) => repo.applyBalanceDelta(BROKERAGE_ACCOUNT_ID, -1, m))).toBe(false);
    expect(await balance()).toBe(-10000);
  });

  it('only locks buy rows', async () => {
    expect(await ds.transaction((m) => repo.lockForUpdate(EXPENSE_ID, m))).toBeUndefined();
    expect(await ds.transaction((m) => repo.lockForUpdate(BUY_ID, m))).toMatchObject({ type: 'buy', settled: false });
  });

  it('sees a settlement committed while it waited for the row lock', async () => {
    const webhook = ds.createQueryRunner();
    await webhook.connect();
    await webhook.startTransaction();
    try {
      await webhook.query(`SELECT 1 FROM transactions WHERE id = $1 FOR UPDATE`, [BUY_ID]);

      const locked = ds.transaction((m) => repo.lockForUpdate(BUY_ID, m));
      await sleep(300); // let the PATCH side start and block on the lock

      await webhook.query(`INSERT INTO order_settlements (order_id, event_id, amount_cents) VALUES ($1, $2, 520000)`, [
        BUY_ID,
        randomUUID(),
      ]);
      await webhook.commitTransaction();

      expect(await locked).toMatchObject({ settled: true });
    } finally {
      await webhook.release();
    }
  });
});
