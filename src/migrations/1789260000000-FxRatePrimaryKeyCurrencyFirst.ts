import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reorders fx_rate's primary key from (source, currency, rate_date) to
 * (currency, rate_date, source) — same three columns, so uniqueness and the
 * upsert's ON CONFLICT target are unchanged; only the B-tree's key order moves.
 *
 * The old order was chosen for `WHERE source = ? AND currency = ? AND
 * rate_date <= ?`, but no code runs that query: `FxRateRepository.findLatest`
 * filters on currency and rate_date only, and `findAllEffective` (the startup
 * cache load) reads the whole table in `currency, rate_date, source` order.
 * Neither could use a source-leading index. Measured with the exact
 * findAllEffective SQL (warm, EXPLAIN ANALYZE) on 307k rows — 40 currencies,
 * 1999–2026:
 *
 *   old PK only                         Seq Scan + 14 MB external disk sort  467 ms  19 MB
 *   old PK + (currency, rate_date)
 *     INCLUDE (source, rate)            Index Only Scan + Incremental Sort   218 ms  31 MB, two indexes
 *   this PK                             Index Scan, no sort                  188 ms  9.5 MB
 *
 * findLatest on this PK: Index Scan Backward, 0.06 ms. The two-index variant
 * was the first attempt; it is slower, 3x the size, and makes every upsert
 * write two B-trees. INCLUDE (rate) on this PK was measured as well and gained
 * nothing (rows arrive roughly in key order, so heap fetches stay cheap).
 *
 * The constraint keeps its name: TypeORM's DefaultNamingStrategy sorts the
 * column names before hashing, so the generated PK name doesn't depend on
 * column order.
 */
export class FxRatePrimaryKeyCurrencyFirst1789260000000 implements MigrationInterface {
  name = 'FxRatePrimaryKeyCurrencyFirst1789260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fx_rate" DROP CONSTRAINT "PK_a492201b9d20e108aef6376dc41"`);
    await queryRunner.query(
      `ALTER TABLE "fx_rate" ADD CONSTRAINT "PK_a492201b9d20e108aef6376dc41" PRIMARY KEY ("currency", "rate_date", "source")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fx_rate" DROP CONSTRAINT "PK_a492201b9d20e108aef6376dc41"`);
    await queryRunner.query(
      `ALTER TABLE "fx_rate" ADD CONSTRAINT "PK_a492201b9d20e108aef6376dc41" PRIMARY KEY ("source", "currency", "rate_date")`,
    );
  }
}
