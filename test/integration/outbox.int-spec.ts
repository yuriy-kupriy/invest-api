import { ConfirmChannel } from 'amqplib';
import { DataSource } from 'typeorm';
import { relayBatch } from '@/broker/relay';
import { checkout, CheckoutRequest } from '@/concurrency/checkout';
import { connect, resetDb } from '../testkit/db';

const ORDER: CheckoutRequest = {
  accountId: '22222222-2222-4222-8222-222222222222', // USD brokerage from db/dev-fixtures.sql
  instrumentId: '00000003-0000-4000-8000-000000000003', // VOO
  quantity: 1,
  unitPriceCents: 10_000,
  description: 'outbox int-spec',
};

/** Just enough of an amqplib confirm channel for publishEvent: `confirm` decides whether the broker ever answers. */
function fakeChannel(confirm: boolean): ConfirmChannel {
  return {
    on: () => undefined,
    publish: (_ex: string, _key: string, _body: Buffer, _opts: unknown, cb: (err: unknown) => void) => {
      if (confirm) setImmediate(() => cb(null));
      return true;
    },
  } as unknown as ConfirmChannel;
}

async function counts(ds: DataSource): Promise<{ orders: number; outbox: number }> {
  const [row]: { orders: number; outbox: number }[] = await ds.query(
    `SELECT (SELECT count(*)::int FROM transactions WHERE description = $1) AS orders,
            (SELECT count(*)::int FROM outbox) AS outbox`,
    [ORDER.description],
  );
  return row;
}

/** HW #22: the order and its event share one COMMIT; one Idempotency-Key is one order; the relay never hangs. */
describe('checkout outbox + relay (integration)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await connect();
  });

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('two concurrent requests with one key make one order and one event', async () => {
    const [a, b] = await Promise.all([
      checkout(ds, ORDER, { idempotencyKey: 'k1' }),
      checkout(ds, ORDER, { idempotencyKey: 'k1' }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.orderId).toBe(b.orderId);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1);
    expect(await counts(ds)).toEqual({ orders: 1, outbox: 1 });
  });

  it('rejects the same key reused for a different order', async () => {
    await checkout(ds, ORDER, { idempotencyKey: 'k1' });
    const reused = await checkout(ds, { ...ORDER, quantity: 5 }, { idempotencyKey: 'k1' });

    expect(reused).toEqual({ ok: false, reason: 'idempotency_key_reuse' });
    expect(await counts(ds)).toEqual({ orders: 1, outbox: 1 });
  });

  it('a failure after the outbox insert rolls back the order and the event together', async () => {
    let outboxInTx = 0;
    await expect(
      checkout(ds, ORDER, {
        beforeCommit: async (manager) => {
          [{ count: outboxInTx }] = await manager.query(`SELECT count(*)::int AS count FROM outbox`);
          throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');

    expect(outboxInTx).toBe(1);
    expect(await counts(ds)).toEqual({ orders: 0, outbox: 0 });
  });

  it('relay: a missing confirm times out and leaves the event for the next pass', async () => {
    await checkout(ds, ORDER);
    const state = async () =>
      (await ds.query(`SELECT published_at IS NOT NULL AS published, attempts FROM outbox`))[0];

    expect(await relayBatch(ds, fakeChannel(false), 100, undefined, 50)).toBe(0);
    expect(await state()).toEqual({ published: false, attempts: 1 });

    expect(await relayBatch(ds, fakeChannel(true))).toBe(1);
    expect(await state()).toEqual({ published: true, attempts: 2 });
  });
});
