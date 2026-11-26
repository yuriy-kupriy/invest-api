import './register-aliases';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { runDemo, USERS } from './demo-auth-kit';

/**
 * Course project demo:webhook — the broker's trade-settlement webhook at the edge.
 * Places a real order through POST /transactions/checkout, then sends four
 * deliveries to POST /webhooks/trades:
 *   forged signature       → 401, nothing written
 *   amount ≠ frozen amount → 422, nothing written
 *   valid event            → 200 settled
 *   the same event again   → 200 duplicate (dedup by event_id in Postgres)
 * and counts the settlement rows: exactly one.
 */

// Before create-app is imported by runDemo: the config is validated at import.
process.env.TRADE_WEBHOOK_SECRET ??= 'demo-webhook-secret-not-a-real-one';
const ACCOUNT = '00000027-0000-4000-8000-000000000001';
const INSTRUMENT = '00000027-0000-4000-8000-0000000000a1';

async function prepare(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO currency (code, numeric_code, exponent, name) VALUES ('USD', 840, 2, 'US dollar')
     ON CONFLICT DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO instruments (id, symbol, name, asset_class, currency)
     VALUES ($1, 'DEMO-WH', 'Webhook demo ETF', 'etf', 'USD') ON CONFLICT (id) DO NOTHING`,
    [INSTRUMENT],
  );
  // runDemo's reset() deleted the owner, and the cascade took the old account with it.
  await ds.query(
    `INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived)
     VALUES ($1, $2, 'UAH', 'Webhook demo', 'brokerage', 100000, false)`,
    [ACCOUNT, USERS.owner.id],
  );
}

runDemo(
  { 'order': [201], 'rejected-signature': [1], 'amount-mismatch': [1], 'accepted': [1], 'duplicates': [1], 'settlements': [1] },
  async (http) => {
    const ds = await new DataSource(dataSourceOptions).initialize();
    try {
      await prepare(ds);
      const { signTradeEvent } = await import('./orders/trade-settlement.service');
      const secret = process.env.TRADE_WEBHOOK_SECRET!;
      const token = (await http.login(USERS.owner)).body.access_token;

      const placed = await fetch(`${http.base}/transactions/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
        body: JSON.stringify({ account_id: ACCOUNT, instrument_id: INSTRUMENT, quantity: 3, unit_price_cents: 2500 }),
      });
      const order = await placed.json();

      const deliver = async (event: object, key = secret) => {
        const raw = JSON.stringify(event);
        const res = await fetch(`${http.base}/webhooks/trades`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-signature': signTradeEvent(key, raw) },
          body: raw,
        });
        return { status: res.status, outcome: ((await res.json()) as { outcome?: string }).outcome };
      };

      const event = { event_id: randomUUID(), order_id: order.id, amount_cents: order.amount_cents };
      const forged = await deliver(event, 'not-the-brokers-key');
      const mismatch = await deliver({ ...event, event_id: randomUUID(), amount_cents: order.amount_cents + 1 });
      const first = await deliver(event);
      const again = await deliver(event);
      const [{ count }]: { count: number }[] = await ds.query(
        `SELECT count(*)::int AS count FROM order_settlements WHERE order_id = $1`,
        [order.id],
      );

      return {
        'order': placed.status,
        'rejected-signature': Number(forged.status === 401),
        'amount-mismatch': Number(mismatch.status === 422),
        'accepted': Number(first.outcome === 'settled'),
        'duplicates': Number(again.outcome === 'duplicate'),
        'settlements': count,
      };
    } finally {
      await ds.destroy();
    }
  },
);
