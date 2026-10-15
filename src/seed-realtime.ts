import './register-aliases';
import { DataSource } from 'typeorm';
import { hashPassword } from './auth/password';
import { dataSourceOptions } from './data-source';

/**
 * HW #18: the fixed world scripts/realtime-demo.mjs and the README curls run
 * against — an owner with two pending orders (A, B) and a second user who owns
 * nothing (the "foreign" join). Re-runnable: the users are deleted and
 * recreated, and the cascade resets their account, orders and balance.
 * Keep the constants in sync with scripts/realtime-demo.mjs.
 */
const PASSWORD = 'demo-password-18';
const OWNER = { id: '00000018-0000-4000-8000-000000000001', email: 'rt-owner@example.com' };
const OTHER = { id: '00000018-0000-4000-8000-000000000002', email: 'rt-other@example.com' };
const ACCOUNT_ID = '00000018-0000-4000-8000-000000000100';
const ORDER_A = '00000018-0000-4000-8000-00000000000a';
const ORDER_B = '00000018-0000-4000-8000-00000000000b';

async function main(): Promise<void> {
  const ds = await new DataSource(dataSourceOptions).initialize();
  try {
    await ds.transaction(async (m) => {
      await m.query(
        `INSERT INTO currency (code, numeric_code, exponent, name) VALUES ('UAH', 980, 2, 'Ukrainian hryvnia')
         ON CONFLICT DO NOTHING`,
      );
      await m.query(
        `INSERT INTO instruments (id, symbol, name, asset_class, currency)
         VALUES ('00000018-0000-4000-8000-000000000200', 'VOO', 'Vanguard S&P 500 ETF', 'etf', 'USD')
         ON CONFLICT (symbol) DO NOTHING`,
      );
      const [{ id: instrumentId }]: { id: string }[] = await m.query(
        `SELECT id FROM instruments WHERE symbol = 'VOO'`,
      );

      await m.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[OWNER.id, OTHER.id]]);
      const passwordHash = await hashPassword(PASSWORD);
      for (const user of [OWNER, OTHER]) {
        await m.query(
          `INSERT INTO users (id, email, display_name, password_hash, role) VALUES ($1, $2, $2, $3, 'member')`,
          [user.id, user.email, passwordHash],
        );
      }
      await m.query(
        `INSERT INTO accounts (id, user_id, currency, name, type, balance_cents)
         VALUES ($1, $2, 'UAH', 'Realtime demo brokerage', 'brokerage', 1000000)`,
        [ACCOUNT_ID, OWNER.id],
      );
      // pending: not booked yet, so the balance above does not include them.
      for (const [id, name] of [[ORDER_A, 'A'], [ORDER_B, 'B']]) {
        await m.query(
          `INSERT INTO transactions
             (id, account_id, instrument_id, currency, type, status, amount_cents, fx_rate,
              quantity_micro, unit_price, booked_at, description)
           VALUES ($1, $2, $3, 'UAH', 'buy', 'pending', 20000, 1, 1000000, 200, now(), $4)`,
          [id, ACCOUNT_ID, instrumentId, `HW #18 realtime demo order ${name}`],
        );
      }
    });
    console.log(`ORDER_A=${ORDER_A}`);
    console.log(`ORDER_B=${ORDER_B}`);
    console.log(`owner=${OWNER.email} other=${OTHER.email} password=${PASSWORD}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
