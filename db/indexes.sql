-- HW #12 — the minimal set of indexes that fixes all three queries in db/queries/.
--
--   docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/indexes.sql
--
-- Exactly three indexes for three queries. Nothing "just in case": every extra
-- index is disk plus a slower INSERT on a 500k-row table. There is deliberately
-- no index under fx_rate — the composite primary key (source, currency,
-- rate_date) already provides it, and it serves the one access pattern rates
-- need.

-- q1 — an account statement for a date range, with keyset pagination.
-- Column order mirrors the query: equality on account_id, then a range and sort
-- on booked_at, id. DESC in the definition lets the planner read the index
-- forward instead of doing a Backward Index Scan, and makes ORDER BY free.
CREATE INDEX transactions_account_booked_idx
  ON transactions (account_id, booked_at DESC, id DESC);

-- q2 — the queue of unfinished operations. PARTIAL: 'pending' is 2.2% of the
-- table, so indexing the other 97.8% makes no sense — those rows can never
-- match this query. The index comes out ~45x smaller than a full one, and it's
-- already sorted, so the Top-N heapsort disappears from the plan.
CREATE INDEX transactions_pending_booked_idx
  ON transactions (booked_at DESC, id)
  WHERE status = 'pending';

-- q3 — case-insensitive lookup. EXPRESSION: the WHERE clause has lower(name),
-- and an index on the bare name column would be ignored by the planner — the
-- expression has to match.
CREATE INDEX accounts_lower_name_idx
  ON accounts (lower(name));

ANALYZE;
