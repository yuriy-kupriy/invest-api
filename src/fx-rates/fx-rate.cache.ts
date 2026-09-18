import { Injectable } from '@nestjs/common';

export interface CachedFxRate {
  rateDate: string;
  rate: string;
  source: string;
}

/** Per-currency series, sorted by `rateDate` ascending, one entry per date. */
type Series = CachedFxRate[];

/**
 * The whole `fx_rate` history held in process, filled once at startup by
 * `FxSyncService` after the NBU delta has been written to the database.
 * ~10k rows per currency since 1999, so all of it is a few MB at most.
 *
 * "Latest rate on or before D" is a binary search over the currency's sorted
 * dates — the in-memory equivalent of the PK backward index scan
 * `FxRateRepository.findLatest` does.
 *
 * The cache only answers dates it can answer *authoritatively*: anything after
 * the last date it holds returns `undefined`, and the service falls back to
 * the database. That covers the one way it can go stale without a restart — a
 * new day's rate written after boot (by another instance's sync, say) — so a
 * transaction booked today never freezes yesterday's rate just because this
 * process started before the rate was published.
 */
@Injectable()
export class FxRateCache {
  private series = new Map<string, Series>();

  /**
   * Replaces the whole index atomically (one Map swap), so a lookup running
   * concurrently with a reload sees either the old or the new data, never a
   * half-built mix. `rows` must be sorted by (currency, rateDate) with at most
   * one row per pair — `FxRateRepository.findAllEffective` guarantees that.
   */
  load(rows: Array<CachedFxRate & { currency: string }>): void {
    const next = new Map<string, Series>();
    for (const { currency, rateDate, rate, source } of rows) {
      let series = next.get(currency);
      if (!series) {
        series = [];
        next.set(currency, series);
      }
      series.push({ rateDate, rate, source });
    }
    this.series = next;
  }

  get size(): number {
    let total = 0;
    for (const series of this.series.values()) total += series.length;
    return total;
  }

  /**
   * `undefined` means "ask the database": either the currency isn't cached
   * at all, or `onDate` is past the last cached date. A date *before* the
   * first cached one is a definite miss inside the cached range — but the DB
   * holds exactly what was loaded, so it is still delegated rather than
   * special-cased; that path is rare and costs one indexed lookup.
   */
  findLatest(currency: string, onDate: string): CachedFxRate | undefined {
    const series = this.series.get(currency);
    if (!series || series.length === 0) return undefined;
    if (onDate > series[series.length - 1].rateDate) return undefined;

    // Rightmost index with rateDate <= onDate. 'YYYY-MM-DD' compares as text.
    let lo = 0;
    let hi = series.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (series[mid].rateDate <= onDate) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found === -1 ? undefined : series[found];
  }
}
