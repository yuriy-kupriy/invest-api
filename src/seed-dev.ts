import './register-aliases';
import { DataSource } from 'typeorm';
import { hashPassword } from './auth/password';
import { dataSourceOptions } from './data-source';

/**
 * Course project: the minimum a reviewer needs to walk the main contour by hand
 * on the compose stack — one member who can log in, a funded UAH account and an
 * instrument to buy. Idempotent: rerunning resets the password and nothing else.
 * Runs as the one-shot `seed` service of `npm run compose:up`.
 */
export const DEV = {
  userId: '00000099-0000-4000-8000-000000000001',
  email: 'reviewer@example.com',
  accountId: '00000099-0000-4000-8000-0000000000a1',
  instrumentId: '00000099-0000-4000-8000-0000000000b1',
};

async function main(): Promise<void> {
  const password = process.env.DEV_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('DEV_USER_PASSWORD (8+ chars) is required — scripts/compose-up.sh generates it into .compose/env');
  }

  const ds = await new DataSource(dataSourceOptions).initialize();
  try {
    await ds.transaction(async (m) => {
      await m.query(
        `INSERT INTO currency (code, numeric_code, exponent, name)
         VALUES ('UAH', 980, 2, 'Ukrainian hryvnia'), ('USD', 840, 2, 'US dollar')
         ON CONFLICT DO NOTHING`,
      );
      await m.query(
        `INSERT INTO users (id, email, display_name, password_hash, role) VALUES ($1, $2, 'Reviewer', $3, 'member')
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [DEV.userId, DEV.email, await hashPassword(password)],
      );
      await m.query(
        `INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived)
         VALUES ($1, $2, 'UAH', 'Reviewer brokerage', 'brokerage', 1000000, false)
         ON CONFLICT (id) DO NOTHING`,
        [DEV.accountId, DEV.userId],
      );
      await m.query(
        `INSERT INTO instruments (id, symbol, name, asset_class, currency)
         VALUES ($1, 'VOO-DEV', 'Vanguard S&P 500 ETF (dev)', 'etf', 'USD')
         ON CONFLICT (id) DO NOTHING`,
        [DEV.instrumentId],
      );
    });
    console.log(`seed-dev: ${DEV.email} / account ${DEV.accountId} / instrument ${DEV.instrumentId}`);
  } finally {
    await ds.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
