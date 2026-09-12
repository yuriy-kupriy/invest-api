import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { FxRate } from '@/entities/fx-rate.entity';

/** `fx_rate.rate_date` is a `date` column — TypeORM reads/writes it as a plain
 * `'YYYY-MM-DD'` string, which sorts and compares correctly as text. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class FxRateRepository {
  constructor(@InjectRepository(FxRate) private readonly repo: Repository<FxRate>) {}

  /**
   * The latest known rate for `currency` on or before `onOrBefore`. Ties (same
   * `rate_date`, several sources — seed data has both `seed` and `seed-alt`)
   * are broken deterministically by `source ASC`, not by insertion order.
   */
  async findLatest(currency: string, onOrBefore: Date): Promise<FxRate | undefined> {
    const row = await this.repo.findOne({
      where: { currency, rateDate: LessThanOrEqual(toDateOnly(onOrBefore)) },
      order: { rateDate: 'DESC', source: 'ASC' },
    });
    return row ?? undefined;
  }
}
