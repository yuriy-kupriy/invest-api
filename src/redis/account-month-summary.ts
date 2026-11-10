import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { cacheAside } from './cache';

export interface MonthSummaryRow {
  category_id: string | null;
  transactions: number;
  total_cents: string;
}

/** Calendar months are Kyiv months, whatever the Postgres session time zone is. */
const SUMMARY_TZ = 'Europe/Kyiv';

/**
 * The "heavy read": per-category totals of one account for one calendar month.
 * Cached with no invalidation on write — a new transaction shows up in the
 * summary within the TTL (at most 6 min). Acceptable for a monthly report.
 */
export class AccountMonthSummaryRepository {
  /** Every round trip to Postgres, counted where the SQL is sent — not where the cache is asked. */
  dbCalls = 0;

  constructor(private readonly ds: DataSource) {}

  async find(accountId: string, month: string): Promise<MonthSummaryRow[]> {
    this.dbCalls++;
    return this.ds.query(
      `SELECT category_id, count(*)::int AS transactions, sum(amount_cents)::text AS total_cents
         FROM transactions
        WHERE account_id = $1
          AND booked_at >= ($2::timestamp AT TIME ZONE '${SUMMARY_TZ}')
          AND booked_at < (($2::timestamp + interval '1 month') AT TIME ZONE '${SUMMARY_TZ}')
        GROUP BY category_id
        ORDER BY category_id`,
      [accountId, `${month}-01`],
    );
  }
}

export const summaryKey = (accountId: string, month: string) => `summary:${accountId}:${month}`;

export function cachedMonthSummary(redis: Redis, repo: AccountMonthSummaryRepository, accountId: string, month: string) {
  return cacheAside(redis, summaryKey(accountId, month), () => repo.find(accountId, month));
}
