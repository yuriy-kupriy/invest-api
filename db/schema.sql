-- HW #12 — domain schema for the course project (Money Manager with investment tracking).
--
-- Applies to a clean database in one command and is re-runnable:
--   docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/schema.sql
--
-- Types: no float anywhere. Amounts are bigint in minor units (cents, ×10^6 for
-- quantity), rates and prices are numeric(20,10). The rationale for that split is
-- in README, section "Why amounts are bigint and rates are numeric".

DROP TABLE IF EXISTS transactions CASCADE;
DROP TABLE IF EXISTS fx_rate     CASCADE;
DROP TABLE IF EXISTS categories  CASCADE;
DROP TABLE IF EXISTS instruments CASCADE;
DROP TABLE IF EXISTS accounts    CASCADE;
DROP TABLE IF EXISTS users       CASCADE;
DROP TABLE IF EXISTS currency    CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- currency — an ISO 4217 lookup instead of CHECK (currency IN (...)).
--
-- The difference is the cost of change: with CHECK, every new currency is a
-- migration that rewrites the constraint (and on transactions that also means
-- scanning all 500k rows); with a lookup table, adding PLN is one INSERT.
-- exponent records how many digits the minor unit has: it is what makes "cents"
-- an objective fact rather than an invented one (UAH/USD/EUR → 2, JPY → 0).
-- numeric_code is the r030 from the NBU currency directory, and the fetcher in
-- HW #23 will join on it.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE currency (
  code         text     PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  numeric_code smallint NOT NULL UNIQUE CHECK (numeric_code BETWEEN 1 AND 999),
  exponent     smallint NOT NULL CHECK (exponent BETWEEN 0 AND 6),
  name         text     NOT NULL CHECK (length(name) BETWEEN 1 AND 80)
);

CREATE TABLE users (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254),
  display_name text        NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency      text        NOT NULL REFERENCES currency(code),
  name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type          text        NOT NULL CHECK (type IN ('cash', 'bank', 'brokerage', 'property')),
  balance_cents bigint      NOT NULL DEFAULT 0,
  is_archived   boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instruments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol      text        NOT NULL UNIQUE CHECK (symbol ~ '^[A-Z0-9.\-]{1,20}$'),
  name        text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  asset_class text        NOT NULL CHECK (asset_class IN ('equity', 'etf', 'bond', 'crypto')),
  currency    text        NOT NULL REFERENCES currency(code),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('income', 'expense'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- fx_rate — a currency's rate on a given date.
--
-- source is part of the primary key: NBU is the primary source, Frankfurter is
-- for backfilling history. Without source in the key, the two sources would
-- collide on (currency, rate_date) and silently overwrite each other — which
-- would remove the very ability to cross-check them that having a second source
-- is for.
--
-- raw_rate/raw_units: providers don't always quote per single unit (JPY is
-- quoted per 10, HUF per 100). rate is the normalized "UAH per 1 unit", and it
-- is GENERATED so the two columns can never drift apart.
--
-- UAH is intentionally absent from this table: it is the quoting base, it lives
-- in currency, and the identity rate is handled at the point of reading. The
-- alternative is either thousands of rows holding the value "one", or a
-- constraint that promises a UAH row that doesn't actually exist.
--
-- PK (source, currency, rate_date) is already the index the one access pattern
-- needs: WHERE source=? AND currency=? AND rate_date <= ? ORDER BY rate_date DESC
-- LIMIT 1 — equality on the first two columns, a range on the third, backward
-- index scan.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fx_rate (
  source     text           NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  currency   text           NOT NULL REFERENCES currency(code),
  rate_date  date           NOT NULL,
  raw_rate   numeric(20,10) NOT NULL CHECK (raw_rate > 0),
  raw_units  integer        NOT NULL DEFAULT 1 CHECK (raw_units > 0),
  rate       numeric(20,10) GENERATED ALWAYS AS ((raw_rate / raw_units)::numeric(20,10)) STORED,
  fetched_at timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (source, currency, rate_date),
  CONSTRAINT fx_rate_base_is_not_quoted CHECK (currency <> 'UAH')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- transactions — the main table (500k rows after seeding).
--
-- fx_rate here is a SNAPSHOT of the rate, not a reference: the hryvnia amount
-- must, for accounting purposes, stay what it was at the moment of the
-- operation, even if NBU later corrects that day's quote. The lookup table
-- answers "what was the rate that day"; the snapshot answers "what rate was
-- this specific operation actually booked at".
--
-- The base-currency amount is not stored: amount_cents * fx_rate is computed on
-- read (bigint * numeric → numeric, no overflow).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE transactions (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid           NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id  uuid           REFERENCES instruments(id) ON DELETE RESTRICT,
  category_id    uuid           REFERENCES categories(id) ON DELETE SET NULL,
  currency       text           NOT NULL REFERENCES currency(code),
  type           text           NOT NULL CHECK (type IN ('income', 'expense', 'transfer_in', 'transfer_out', 'buy', 'sell')),
  status         text           NOT NULL DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'failed')),
  amount_cents   bigint         NOT NULL CHECK (amount_cents >= 0),
  fx_rate        numeric(20,10) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  quantity_micro bigint         CHECK (quantity_micro > 0),
  unit_price     numeric(20,10) CHECK (unit_price > 0),
  booked_at      timestamptz    NOT NULL,
  description    text           CHECK (length(description) <= 500),
  created_at     timestamptz    NOT NULL DEFAULT now(),

  -- An investment operation without an instrument — or vice versa — is a lie in the data.
  CONSTRAINT transactions_instrument_matches_type
    CHECK ((type IN ('buy', 'sell')) = (instrument_id IS NOT NULL)),

  -- A hryvnia operation with a rate other than 1 would mean the snapshot was taken from the wrong currency.
  CONSTRAINT transactions_base_currency_rate_is_one
    CHECK ((currency = 'UAH') = (fx_rate = 1))
);

-- The app role is created by db/init.sql the first time the volume comes up.
-- The DO block keeps this file re-runnable on a database where that role does
-- not exist yet.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invest_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO invest_app;
  END IF;
END
$$;
