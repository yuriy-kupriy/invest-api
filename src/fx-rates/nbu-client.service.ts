import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { Env } from '@/config/env.schema';

/** `fx_rate.source` for rows fetched live from the NBU API. Deliberately not
 * `'NBU'`: db/seed.sql writes *synthetic* rows under that name, and the sync
 * resumes from `MAX(rate_date)` per source — sharing it would make the sync
 * mistake three years of made-up numbers for real history and never backfill. */
export const NBU_SOURCE = 'nbu';

/** One `fx_rate` row as the sync writes it (`rate` is GENERATED, not written). */
export interface FxRateRow {
  currency: string;
  rateDate: string;
  rawRate: string;
  rawUnits: number;
}

/**
 * Shape of one element of `/NBU_Exchange/exchange_site?...&json`. Only the
 * fields we use are validated; the rest (`txt`, `enname`, `calcdate`, …) is
 * ignored. `rate` is per `units` (JPY in 1999 was quoted per 1000), which maps
 * straight onto `raw_rate` / `raw_units`.
 */
const nbuRecordSchema = z.object({
  exchangedate: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/),
  r030: z.number().int(),
  cc: z.string(),
  rate: z.number().positive(),
  units: z.number().int().positive(),
});

const nbuResponseSchema = z.array(nbuRecordSchema);

/** `YYYY-MM-DD` → `YYYYMMDD`, the date format NBU expects in query params. */
function toNbuParam(date: string): string {
  return date.replaceAll('-', '');
}

/** NBU's `dd.mm.yyyy` → the `YYYY-MM-DD` string a `date` column round-trips as. */
export function parseNbuDate(value: string): string {
  const [dd, mm, yyyy] = value.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

/** Split out so the response mapping is unit-testable without HTTP.
 *
 * `numericCode` (`currency.numeric_code`, ISO 4217) is *not* cross-checked
 * against the response's `r030` here: NBU's own archive isn't internally
 * consistent about it. Discovered live while adding this — `valcode=gel`
 * returns `r030=381` for dates before ~2002-09 and `r030=981` (GEL's real ISO
 * numeric code) after, apparently an NBU-side internal code that predates
 * some historical migration on their end. `cc` (the three-letter code) is the
 * reliable signal that this response is really for the currency asked for.
 */
export function parseNbuResponse(
  body: unknown,
  currency: { code: string; numericCode: number },
): FxRateRow[] {
  const records = nbuResponseSchema.parse(body);

  return records.map((record) => {
    if (record.cc !== currency.code) {
      throw new Error(`NBU returned ${record.cc} when asked for ${currency.code}`);
    }
    return {
      currency: currency.code,
      rateDate: parseNbuDate(record.exchangedate),
      // NBU quotes at most 4-6 decimals, well inside float64's exact
      // round-trip range, so String() reproduces the published digits.
      rawRate: String(record.rate),
      rawUnits: record.units,
    };
  });
}

/**
 * Thin wrapper around the NBU `exchange_site` history endpoint — the only
 * outbound HTTP call in the app, kept as its own injectable so `FxSyncService`
 * doesn't hold connection details, and so a test can substitute a mock without
 * touching the network (see `fx-sync.service.spec.ts`).
 */
@Injectable()
export class NbuClient {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Unlike the per-date `statdirectory/exchange` endpoint, `exchange_site`
   * returns a whole date range for one currency in a single response — the
   * full history since 1999 is ~2 MB and about a second, so there is no need
   * to chunk. NBU publishes a row for every calendar day (weekends carry
   * Friday's rate), and tomorrow's rate is usually out by the afternoon.
   */
  async fetchRates(
    currency: { code: string; numericCode: number },
    from: string,
    to: string,
  ): Promise<FxRateRow[]> {
    const baseUrl = this.config.get('NBU_BASE_URL', { infer: true });
    const timeoutMs = this.config.get('NBU_TIMEOUT_MS', { infer: true });

    const url = new URL('/NBU_Exchange/exchange_site', baseUrl);
    url.searchParams.set('start', toNbuParam(from));
    url.searchParams.set('end', toNbuParam(to));
    url.searchParams.set('valcode', currency.code.toLowerCase());
    url.searchParams.set('sort', 'exchangedate');
    url.searchParams.set('order', 'asc');
    url.searchParams.set('json', '');

    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(`NBU ${currency.code} ${from}..${to}: HTTP ${response.status}`);
    }

    return parseNbuResponse(await response.json(), currency);
  }
}
