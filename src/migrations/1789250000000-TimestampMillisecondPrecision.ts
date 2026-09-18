import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pins every timestamptz column to millisecond precision, which is the only
 * precision this system can actually represent end to end.
 *
 * The bug this fixes: keyset pagination encodes its cursor from the domain
 * value, which comes from a JS `Date` — and `Date` holds milliseconds, so
 * `toISOString()` yields `…:36.035Z` for a row physically stored as
 * `…:36.035363+00`. The comparison `(created_at, id) < (:c, :id)` then reads
 * that row as *newer* than its own cursor, and every row inside the same
 * millisecond bucket is skipped: with three accounts sharing
 * `12:33:36.035363`, `GET /accounts?limit=2` returned pages 1 and 2 without
 * ever returning the third.
 *
 * Fixing it in the predicate would mean either `date_trunc()` (which the
 * (account_id, booked_at DESC, id DESC) index can't serve) or a two-branch
 * millisecond-bucket comparison. Storing what we can represent is simpler and
 * removes the whole class: `now()` is rounded to milliseconds on write, so the
 * value a client sees is byte-for-byte the value the cursor compares against.
 * The wire contract already promised this — openapi.yaml types these as
 * `format: date-time` and every example carries exactly three decimals.
 *
 * NOTE: this rewrites both tables (ALTER COLUMN TYPE with a narrower
 * precision is not a metadata-only change). At the seeded 500k rows it takes
 * seconds; on a real table it would want the usual add-column/backfill/swap
 * dance instead. `down()` widens the type back, but cannot resurrect the
 * sub-millisecond digits this rounds away — they are gone once `up()` runs.
 */
export class TimestampMillisecondPrecision1789250000000 implements MigrationInterface {
  name = 'TimestampMillisecondPrecision1789250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "created_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "instruments" ALTER COLUMN "created_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "booked_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "created_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "fx_rate" ALTER COLUMN "fetched_at" TYPE TIMESTAMP(3) WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "fx_rate" ALTER COLUMN "fetched_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "transactions" ALTER COLUMN "booked_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "instruments" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "created_at" TYPE TIMESTAMP WITH TIME ZONE`);
  }
}
