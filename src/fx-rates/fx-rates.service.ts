import { HttpStatus, Injectable } from '@nestjs/common';
import { problem } from '@/shared/problem.exception';
import { FxRateRepository, toDateOnly } from './fx-rate.repository';

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
   * Used on the write path (`TransactionsRepository.save()`): a missing rate
   * there means the request as given can't be completed, hence 422 — the same
   * status `transactions.service.ts` already uses for `currency-mismatch`.
   */
  async getEffectiveRate(currency: string, on: Date): Promise<string> {
    if (currency === 'UAH') {
      return '1';
    }
    const row = await this.fxRateRepo.findLatest(currency, on);
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
