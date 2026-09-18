import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, LessThanOrEqual, Repository } from 'typeorm';
import { FxRate } from '@/entities/fx-rate.entity';
import type { CachedFxRate } from './fx-rate.cache';
import type { FxRateRow } from './nbu-client.service';

/** Rows per upsert: 5 params each, far below pg's 65535-parameter limit. */
const UPSERT_CHUNK = 1000;

/** `fx_rate.rate_date` is a `date` column — TypeORM reads/writes it as a plain
 * `'YYYY-MM-DD'` string, which sorts and compares correctly as text. */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Dedup key for a (currency, date) rate lookup — same shape a caller needs
 * to batch several transactions' rate resolutions into one query per unique
 * pair instead of one per transaction. */
export function fxRateKey(currency: string, on: Date): string {
  return `${currency}:${toDateOnly(on)}`;
}

@Injectable()
export class FxRateRepository {
  constructor(@InjectRepository(FxRate) private readonly repo: Repository<FxRate>) {}

  /**
   * The latest known rate for `currency` on or before `onOrBefore`. Ties (same
   * `rate_date`, several sources — seed data has both `seed` and `seed-alt`)
   * are broken deterministically by `source ASC`, not by insertion order.
   */
  async findLatest(
    currency: string,
    onOrBefore: Date,
    manager?: EntityManager,
  ): Promise<FxRate | undefined> {
    const repo = manager ? manager.getRepository(FxRate) : this.repo;
    const row = await repo.findOne({
      where: { currency, rateDate: LessThanOrEqual(toDateOnly(onOrBefore)) },
      order: { rateDate: 'DESC', source: 'ASC' },
    });
    return row ?? undefined;
  }

  /** Every currency `fx_rate` can hold — all of `currency` except the UAH base. */
  async findQuotedCurrencies(): Promise<Array<{ code: string; numericCode: number }>> {
    return this.repo.query(
      `SELECT code, numeric_code AS "numericCode" FROM currency WHERE code <> 'UAH' ORDER BY code`,
    );
  }

  /**
   * Last stored `rate_date` per currency for one source — where the startup
   * sync resumes from, so a restart fetches days since the last run rather
   * than the whole history since 1999.
   */
  async findLastDates(source: string): Promise<Map<string, string>> {
    const rows: Array<{ currency: string; last: string }> = await this.repo
      .createQueryBuilder('r')
      .select('r.currency', 'currency')
      .addSelect(`to_char(MAX(r.rate_date), 'YYYY-MM-DD')`, 'last')
      .where('r.source = :source', { source })
      .groupBy('r.currency')
      .getRawMany();
    return new Map(rows.map((row) => [row.currency, row.last]));
  }

  /**
   * Insert-or-correct in chunks: a re-fetched day NBU has since revised gets
   * the new value, an unchanged one is skipped by Postgres rather than
   * rewritten (`skipUpdateIfNoValuesChanged`).
   */
  async upsertMany(source: string, rows: FxRateRow[]): Promise<void> {
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      await this.repo.upsert(
        rows.slice(i, i + UPSERT_CHUNK).map((row) => ({ source, ...row })),
        { conflictPaths: ['source', 'currency', 'rateDate'], skipUpdateIfNoValuesChanged: true },
      );
    }
  }

  /**
   * Every (currency, date) with the row `findLatest` would pick for it — same
   * `source ASC` tie-break, applied by `DISTINCT ON` in the database so the
   * in-memory index can never order sources differently than the SQL path.
   */
  async findAllEffective(): Promise<Array<CachedFxRate & { currency: string }>> {
    return this.repo.query(
      `SELECT DISTINCT ON (currency, rate_date)
              currency, to_char(rate_date, 'YYYY-MM-DD') AS "rateDate", rate::text AS rate, source
         FROM fx_rate
        ORDER BY currency, rate_date, source ASC`,
    );
  }
}
