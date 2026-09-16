import { cpus } from 'node:os';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { from, lastValueFrom, mergeMap, toArray } from 'rxjs';
import { Env } from '@/config/env.schema';
import { FxRateCache } from './fx-rate.cache';
import { FxRateRepository, toDateOnly } from './fx-rate.repository';
import { NBU_SOURCE, NbuClient } from './nbu-client.service';

/** `YYYY-MM-DD` plus `days`, in UTC — `rate_date` has no time zone. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateOnly(d);
}

function message(error: unknown): unknown {
  return error instanceof Error ? error.message : error;
}

/**
 * Startup sequence, awaited — `app.listen()` runs bootstrap hooks before
 * binding the port, so no request is served against an empty cache:
 *
 * 1. `FX_SYNC_ON_START=1` → for every non-base currency in `currency`, fetch
 *    from NBU (via the injected `NbuClient`) only the days from its last
 *    stored `NBU_SOURCE` date (or
 *    `FX_BACKFILL_FROM` when there is none) through tomorrow, and upsert them.
 *    The last stored day is re-fetched on purpose: it is the one NBU is most
 *    likely to have corrected. Tomorrow, because NBU publishes the next day's
 *    rate in the afternoon; days that don't exist yet are simply omitted.
 *
 *    Currencies are synced **in parallel**, via RxJS `mergeMap` — literally N
 *    parallel streams merged into one, and `rxjs` is already a direct
 *    dependency (NestJS itself needs it), so this adds nothing new. With ~40
 *    NBU-quoted currencies, one-at-a-time (~1.2s each) would be the better
 *    part of a minute; concurrency bounded by `min(cpus, DB_POOL_MAX)` keeps a
 *    many-core box from opening more concurrent pg connections than the pool
 *    has, while still cutting wall time to a handful of batches. One
 *    currency's `mergeMap` projection never throws (`syncCurrency` catches
 *    internally), so it can't cancel the others — same isolation the old
 *    sequential loop had.
 * 2. Load every effective rate into `FxRateCache`.
 *
 * Neither step can take the app down: NBU unreachable → serve what the table
 * already has; cache load failing → every lookup falls through to the database.
 *
 * No cross-instance lock: the upsert is idempotent, so two instances syncing at
 * once cost a duplicate NBU request and nothing else.
 */
@Injectable()
export class FxSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FxSyncService.name);

  constructor(
    private readonly fxRateRepo: FxRateRepository,
    private readonly cache: FxRateCache,
    private readonly config: ConfigService<Env, true>,
    private readonly nbuClient: NbuClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('FX_SYNC_ON_START', { infer: true }) === '1') {
      try {
        await this.sync();
      } catch (error) {
        this.logger.warn(`fx sync failed, serving stored rates — ${message(error)}`);
      }
    }

    try {
      const startedAt = Date.now();
      this.cache.load(await this.fxRateRepo.findAllEffective());
      this.logger.log(`fx cache loaded: ${this.cache.size} rates in ${Date.now() - startedAt} ms`);
    } catch (error) {
      this.logger.error(`fx cache load failed, lookups go to the database — ${message(error)}`);
    }
  }

  /**
   * @param concurrency How many currencies to sync at once. Defaults to
   *   `min(cpus().length, DB_POOL_MAX)`; tests pass a small fixed number
   *   instead, so overlap is deterministic rather than tied to the runner's
   *   actual core count.
   */
  async sync(concurrency = this.defaultConcurrency()): Promise<void> {
    const backfillFrom = this.config.get('FX_BACKFILL_FROM', { infer: true });
    const to = addDays(toDateOnly(new Date()), 1);

    const currencies = await this.fxRateRepo.findQuotedCurrencies();
    const lastDates = await this.fxRateRepo.findLastDates(NBU_SOURCE);

    await lastValueFrom(
      from(currencies).pipe(
        mergeMap(
          (currency) => this.syncCurrency(currency, lastDates.get(currency.code) ?? backfillFrom, to),
          concurrency,
        ),
        toArray(),
      ),
    );
  }

  private defaultConcurrency(): number {
    const poolMax = this.config.get('DB_POOL_MAX', { infer: true });
    return Math.max(1, Math.min(cpus().length, poolMax));
  }

  private async syncCurrency(
    currency: { code: string; numericCode: number },
    from: string,
    to: string,
  ): Promise<void> {
    try {
      const rows = await this.nbuClient.fetchRates(currency, from, to);
      await this.fxRateRepo.upsertMany(NBU_SOURCE, rows);
      this.logger.log(`${currency.code}: ${from}..${to} upserted ${rows.length} rows`);
    } catch (error) {
      // One currency failing (NBU doesn't quote it, a timeout) must not throw
      // away the others' progress — each upsert commits on its own, and this
      // catch keeps the mergeMap'd observable from erroring out for the rest.
      this.logger.warn(`${currency.code}: sync failed — ${message(error)}`);
    }
  }
}
