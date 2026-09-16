import { HttpStatus, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { problem } from '@/shared/problem.exception';
import { FxRateRepository, fxRateKey, toDateOnly } from './fx-rate.repository';

export interface EffectiveFxRate {
  currency: string;
  rate: string;
  rateDate: string;
  source: string;
}

@Injectable()
export class FxRatesService {
  constructor(private readonly fxRateRepo: FxRateRepository) {}

  /**
   * Used on the write path (`TransactionsRepository.saveMany()`): a missing
   * rate there means the request as given can't be completed, hence 422 — the
   * same status `transactions.service.ts` already uses for `currency-mismatch`.
   */
  async getEffectiveRate(currency: string, on: Date, manager?: EntityManager): Promise<string> {
    if (currency === 'UAH') {
      return '1';
    }
    const row = await this.fxRateRepo.findLatest(currency, on, manager);
    if (!row) {
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'fx-rate-unavailable',
        `no fx rate for ${currency} on or before ${toDateOnly(on)}`,
      );
    }
    return row.rate;
  }

  /**
   * Batched form of `getEffectiveRate` for a create-transactions batch: a
   * real batch of up to 100 entries typically spans 1-3 distinct
   * (currency, date) pairs (most entries share their account's currency), so
   * resolving by unique pair instead of per-entry turns up to 100 rate
   * lookups into a handful. Returns a map keyed by `fxRateKey(currency, on)`.
   */
  async getEffectiveRates(
    pairs: Array<{ currency: string; on: Date }>,
    manager?: EntityManager,
  ): Promise<Map<string, string>> {
    const unique = new Map<string, { currency: string; on: Date }>();
    for (const pair of pairs) {
      unique.set(fxRateKey(pair.currency, pair.on), pair);
    }

    const result = new Map<string, string>();
    for (const [key, { currency, on }] of unique) {
      result.set(key, await this.getEffectiveRate(currency, on, manager));
    }
    return result;
  }

  /**
   * Used on the read path (`FxRatesController`): a missing rate there means
   * the resource being asked for doesn't exist, hence 404.
   */
  async getLatest(currency: string, on: Date): Promise<EffectiveFxRate> {
    if (currency === 'UAH') {
      return { currency, rate: '1', rateDate: toDateOnly(on), source: 'base' };
    }
    const row = await this.fxRateRepo.findLatest(currency, on);
    if (!row) {
      throw problem(
        HttpStatus.NOT_FOUND,
        'fx-rate-not-found',
        `no fx rate for ${currency} on or before ${toDateOnly(on)}`,
      );
    }
    return { currency: row.currency, rate: row.rate, rateDate: row.rateDate, source: row.source };
  }
}
