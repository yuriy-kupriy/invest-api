-- HW #12 — populate the database with a realistic volume of data.
--
--   docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/seed.sql
--
-- 20k users / 60k accounts / 500k transactions. The distributions are
-- intentionally skewed: on uniform data EXPLAIN would show nothing, because the
-- planner would rightly pick a Seq Scan regardless of any indexes.
--
-- setseed makes random() reproducible within the session — that's why the
-- literals in db/queries/q1.sql and q3.sql don't "go stale" after a reseed. Ids
-- and account names are fully deterministic (md5 of the row number), so they
-- don't even depend on the seed.

SELECT setseed(0.42);

TRUNCATE transactions, fx_rate, categories, instruments, accounts, users, currency CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- currency — adding a new currency now means appending a row here, not a migration.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO currency (code, numeric_code, exponent, name) VALUES
  ('UAH', 980, 2, 'Ukrainian hryvnia'),
  ('USD', 840, 2, 'United States dollar'),
  ('EUR', 978, 2, 'Euro');

-- ─────────────────────────────────────────────────────────────────────────────
-- users — 20,000
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO users (id, email, display_name, created_at)
SELECT
  md5('user:' || n)::uuid,
  'user' || n || '@example.com',
  nm.first_names[1 + n % array_length(nm.first_names, 1)] || ' ' ||
  nm.last_names[1 + (n / 11) % array_length(nm.last_names, 1)],
  now() - make_interval(days => 1200 - (n % 1200))
FROM generate_series(1, 20000) AS n,
     (SELECT ARRAY['Олена','Андрій','Ірина','Дмитро','Наталія','Сергій','Оксана','Юрій',
                   'Марія','Богдан','Тетяна','Віктор'] AS first_names,
             ARRAY['Коваль','Шевченко','Бондаренко','Мельник','Ткаченко','Кравченко',
                   'Олійник','Гончар','Лисенко','Марченко','Савченко','Руденко'] AS last_names) nm;

-- ─────────────────────────────────────────────────────────────────────────────
-- accounts — 60,000.
--
-- The name is deterministic (no random) and unique thanks to the #n suffix —
-- that's exactly why the literal in q3 is stable and hits exactly one row. The
-- account's currency is also a pure function of n, so the transaction insert
-- below can pick it up without a join.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO accounts (id, user_id, currency, name, type, balance_cents, is_archived, created_at)
SELECT
  md5('account:' || n)::uuid,
  md5('user:' || (1 + (n * 7919) % 20000))::uuid,
  a.cur,
  a.bank || ' ' || a.cur || ' #' || n,
  a.typ,
  (power(10, 4 + random() * 4))::bigint,
  (n % 37 = 0),
  now() - make_interval(days => 1000 - (n % 1000))
FROM generate_series(1, 60000) AS n
CROSS JOIN LATERAL (
  SELECT
    (ARRAY['UAH','UAH','UAH','UAH','UAH','UAH','UAH','USD','USD','EUR'])[1 + n % 10] AS cur,
    (ARRAY['Monobank','PrivatBank','Oschadbank','IBKR','Revolut','Wise','Sense','Ukrsib'])[1 + (n / 10) % 8] AS bank,
    (ARRAY['cash','bank','bank','bank','brokerage','property','bank'])[1 + (n / 3) % 7] AS typ
) a;

-- ─────────────────────────────────────────────────────────────────────────────
-- instruments — 500
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO instruments (id, symbol, name, asset_class, currency)
SELECT
  md5('instrument:' || n)::uuid,
  'SYM' || lpad(n::text, 4, '0'),
  'Instrument ' || n,
  (ARRAY['equity','equity','equity','etf','bond','crypto'])[1 + n % 6],
  (ARRAY['USD','USD','USD','EUR'])[1 + n % 4]
FROM generate_series(1, 500) AS n;

-- ─────────────────────────────────────────────────────────────────────────────
-- categories — 24
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO categories (id, name, kind)
SELECT
  md5('category:' || n)::uuid,
  c.names[n],
  CASE WHEN n <= 4 THEN 'income' ELSE 'expense' END
FROM generate_series(1, 24) AS n,
     (SELECT ARRAY['Зарплата','Фріланс','Дивіденди','Оренда отримана',
                   'Продукти','Кафе та ресторани','Транспорт','Пальне','Комуналка',
                   'Звязок','Інтернет','Оренда житла','Одяг','Здоровя','Аптека',
                   'Спорт','Освіта','Подорожі','Розваги','Подарунки','Техніка',
                   'Ремонт','Страхування','Податки'] AS names) c;

-- ─────────────────────────────────────────────────────────────────────────────
-- fx_rate — 3 years, business days only (matching how NBU publishes), USD and EUR.
--
-- UAH is intentionally absent here: it is the quoting base (see the CHECK in
-- schema.sql). The values are synthetic — seed must run offline in the grader's
-- container — but the order of magnitude matches the live NBU feed as of
-- September 2026 (USD ≈ 44.5, EUR ≈ 51.8) and is rounded to 4 decimals, like a
-- real response. Real history can be loaded separately: see the README section
-- on the Frankfurter CSV.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO fx_rate (source, currency, rate_date, raw_rate, raw_units)
SELECT
  'NBU',
  s.cc,
  d::date,
  round((
    s.base
    + s.slope * (d::date - b.d0)::float8 / b.span::float8
    + s.amp * sin((d::date - b.d0)::float8 / s.period)
    + (random() - 0.5) * s.noise
  )::numeric, 4),
  1
FROM (SELECT (current_date - interval '3 years')::date AS d0,
             (current_date - (current_date - interval '3 years')::date) AS span) b,
     generate_series(b.d0, current_date, interval '1 day') d,
     (VALUES ('USD', 38.5::float8,  6.0::float8, 0.60::float8, 45.0::float8, 0.15::float8),
             ('EUR', 41.5::float8, 10.3::float8, 0.90::float8, 60.0::float8, 0.20::float8)
     ) AS s(cc, base, slope, amp, period, noise)
WHERE EXTRACT(isodow FROM d) < 6;

-- ─────────────────────────────────────────────────────────────────────────────
-- transactions — 500,000, the main table.
--
-- The rate is baked in as a snapshot. Weekends have no quote, so each row needs
-- the rate from the last business day on or before its own date; doing that with
-- a LATERAL subquery on every one of 500k rows would be expensive, so a dense
-- array indexed by calendar day is built first, with forward-fill (~1,100
-- subqueries), and rows read from it in O(1). The array is float8[] on purpose:
-- numeric is varlena, and subscripting it would mean "unrolling" it, whereas
-- float8 is fixed-length and gives true constant-time access.
-- ─────────────────────────────────────────────────────────────────────────────
WITH b AS (
  SELECT (current_date - interval '3 years')::date AS d0,
         (current_date - (current_date - interval '3 years')::date) AS span
),
dense AS (
  SELECT
    (d::date - b.d0) AS off,
    (SELECT f.rate FROM fx_rate f
      WHERE f.source = 'NBU' AND f.currency = 'USD' AND f.rate_date <= d::date
      ORDER BY f.rate_date DESC LIMIT 1) AS usd,
    (SELECT f.rate FROM fx_rate f
      WHERE f.source = 'NBU' AND f.currency = 'EUR' AND f.rate_date <= d::date
      ORDER BY f.rate_date DESC LIMIT 1) AS eur
  FROM b, generate_series(b.d0, current_date, interval '1 day') d
),
arr AS (
  SELECT
    array_agg(coalesce(usd, 38.5)::float8 ORDER BY off) AS usd,
    array_agg(coalesce(eur, 41.5)::float8 ORDER BY off) AS eur
  FROM dense
)
INSERT INTO transactions (
  id, account_id, instrument_id, category_id, currency, type, status,
  amount_cents, fx_rate, quantity_micro, unit_price, booked_at, description
)
SELECT
  md5('txn:' || g)::uuid,
  md5('account:' || p.acct_idx)::uuid,
  CASE WHEN p.ttype IN ('buy','sell') THEN md5('instrument:' || (1 + g % 500))::uuid END,
  CASE WHEN p.ttype IN ('income','expense') THEN md5('category:' || (1 + g % 24))::uuid END,
  p.cur,
  p.ttype,
  CASE
    WHEN r.r_status < 0.9700 THEN 'posted'
    WHEN r.r_status < 0.9920 THEN 'pending'
    ELSE 'failed'
  END,
  (power(10, 2 + r.r_amt * 3.6))::bigint,
  CASE p.cur
    WHEN 'UAH' THEN 1
    WHEN 'USD' THEN round(arr.usd[p.day_off + 1]::numeric, 4)
    ELSE              round(arr.eur[p.day_off + 1]::numeric, 4)
  END,
  CASE WHEN p.ttype IN ('buy','sell') THEN (power(10, 5 + r.r_amt * 3))::bigint END,
  CASE WHEN p.ttype IN ('buy','sell') THEN round((10 + r.r_desc * 500)::numeric, 4) END,
  (b.d0 + p.day_off)::timestamptz + make_interval(secs => floor(r.r_desc * 86400)::int),
  CASE WHEN r.r_desc < 0.3 THEN 'Операція #' || g END
FROM b, arr, generate_series(1, 500000) AS g
CROSS JOIN LATERAL (
  -- Six independent pseudo-random streams, each a pure function of the row
  -- number: md5 with its own label, first 32 bits, normalized to [0, 1).
  --
  -- random() must NOT be used here: a subquery containing only random() does
  -- not depend on g, so the planner evaluates it once for the whole INSERT and
  -- all 500k rows come out identical (verified — everything was
  -- 'expense'/'posted'/'USD'). Tying each stream to g both fixes that and makes
  -- the data reproducible independently of setseed.
  SELECT
    (('x' || substr(md5('type:'   || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_type,
    (('x' || substr(md5('status:' || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_status,
    (('x' || substr(md5('acct:'   || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_acct,
    (('x' || substr(md5('day:'    || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_day,
    (('x' || substr(md5('amt:'    || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_amt,
    (('x' || substr(md5('desc:'   || g), 1, 8))::bit(32)::bigint / 4294967296.0)::float8 AS r_desc
) r
CROSS JOIN LATERAL (
  SELECT
    1 + floor(60000 * power(r.r_acct, 3))::int AS acct_idx,
    b.span - floor(power(r.r_day, 2) * b.span)::int AS day_off,
    CASE
      WHEN r.r_type < 0.55 THEN 'expense'
      WHEN r.r_type < 0.75 THEN 'income'
      WHEN r.r_type < 0.83 THEN 'transfer_out'
      WHEN r.r_type < 0.91 THEN 'transfer_in'
      WHEN r.r_type < 0.97 THEN 'buy'
      ELSE 'sell'
    END AS ttype
) q
CROSS JOIN LATERAL (
  SELECT
    q.acct_idx,
    q.day_off,
    q.ttype,
    (ARRAY['UAH','UAH','UAH','UAH','UAH','UAH','UAH','USD','USD','EUR'])[1 + q.acct_idx % 10] AS cur
) p;

-- VACUUM, not just ANALYZE. ANALYZE gives the planner statistics, but only
-- VACUUM sets the visibility map; without it an Index Only Scan still has to
-- visit the heap (Heap Fetches in the plan), and the "after" buffers come out
-- much worse than they could be.
VACUUM (ANALYZE);
