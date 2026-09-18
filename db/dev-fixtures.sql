-- Optional, idempotent fixture data for local/manual runs of the API
-- (`npm start`, `npm run start:dev`, `npm run test:e2e`) against a freshly
-- migrated database that hasn't been through the full `npm run seed`.
--
-- It reproduces exactly the three accounts and two transactions that the old
-- in-memory repositories used to fabricate in process on every boot — same
-- ids, same amounts — now as real rows behind the TypeORM backend. Neither
-- `npm test` nor the grading flow needs this file: unit specs mock the
-- repository and never touch a database, and `npm run seed` (src/seed.ts)
-- already provides a larger, richer dataset.
--
-- Run against a database that already has the migration applied:
--   docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/dev-fixtures.sql
-- Re-running is safe: every INSERT is ON CONFLICT DO NOTHING.

INSERT INTO currency (code, numeric_code, exponent, name) VALUES
  ('UAH', 980, 2, 'Ukrainian hryvnia'),
  ('USD', 840, 2, 'United States dollar')
ON CONFLICT (code) DO NOTHING;

-- Fixed system user accounts attach to — the HW #9 domain type has no concept
-- of account ownership, so every account created through the API attaches
-- here too (see src/accounts/typeorm-accounts.repository.ts).
INSERT INTO users (id, email, display_name) VALUES
  ('00000001-0000-4000-8000-000000000001', 'user1@example.com', 'Olena Koval')
ON CONFLICT (id) DO NOTHING;

INSERT INTO instruments (id, symbol, name, asset_class, currency) VALUES
  ('00000003-0000-4000-8000-000000000003', 'VOO', 'Vanguard S&P 500 ETF', 'etf', 'USD')
ON CONFLICT (id) DO NOTHING;

INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived) VALUES
  ('11111111-1111-4111-8111-111111111111', '00000001-0000-4000-8000-000000000001', 'UAH', 'Cash UAH', 'cash', 350000, false),
  ('22222222-2222-4222-8222-222222222222', '00000001-0000-4000-8000-000000000001', 'USD', 'IBKR brokerage', 'brokerage', 1250000, false),
  ('33333333-3333-4333-8333-333333333333', '00000001-0000-4000-8000-000000000001', 'USD', 'Apartment in Pechersk', 'property', 9500000, false)
ON CONFLICT (id) DO NOTHING;

-- fx_rate is a snapshot on the row itself, not a lookup join — 1 for the UAH
-- expense (transactions_base_currency_rate_is_one), the same placeholder USD
-- rate the TypeORM repository uses elsewhere for the VOO buy.
INSERT INTO transactions
  (id, account_id, instrument_id, category_id, currency, type, status, amount_cents, fx_rate, quantity_micro, unit_price, booked_at, description)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', NULL, NULL, 'UAH', 'expense', 'posted', 4599, 1, NULL, NULL, '2026-08-20T12:30:00Z', 'Coffee and breakfast'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '00000003-0000-4000-8000-000000000003', NULL, 'USD', 'buy', 'posted', 520000, 41.5, 10000000, 52.0, '2026-08-21T14:00:00Z', 'Bought 10 VOO shares')
ON CONFLICT (id) DO NOTHING;
