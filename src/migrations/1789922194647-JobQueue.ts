import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The post-processing queue for HW #14: checkout writes a receipt job in the
 * same transaction as the order, and a pool of workers claims rows with
 * FOR UPDATE SKIP LOCKED.
 *
 * Column set is deliberately the minimum the queue needs to be provable:
 *   status     — what the claim query filters on;
 *   processed  — how many times a handler actually ran for this row. It is the
 *                exactly-once check: any row with processed > 1 means two
 *                workers claimed the same job;
 *   worker_id  — which worker claimed it, so the per-worker distribution is
 *                readable from the table and not only from process memory;
 *   created_at — a stable FIFO order for the claim query.
 * No attempts/last_error/run_after: nothing in this homework retries or delays
 * a job, and an unused column is a lie about the design.
 *
 * `job_queue_pending_created_idx` is partial (pending rows only) because that is
 * the only set the claim query ever scans, and it stays small as done rows pile
 * up — same reasoning and same shape as transactions_pending_booked_idx in
 * InitSchema. A WHERE clause has no @Index syntax, so the DDL lives here and the
 * entity only declares the name with { synchronize: false }.
 *
 * NOTE for future `migration:generate` runs: the generator proposed
 * `DROP CONSTRAINT "transactions_currency_matches_account"` (composite FKs are
 * not expressible with decorators — see AccountCurrencyGuard) and
 * `uuid_generate_v4()` for the PK default (this database has pgcrypto's
 * gen_random_uuid(), not uuid-ossp). Both were corrected by hand here, exactly
 * as InitSchema was.
 */
export class JobQueue1789922194647 implements MigrationInterface {
  name = 'JobQueue1789922194647';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "job_queue" (` +
        `"id" uuid NOT NULL DEFAULT gen_random_uuid(), ` +
        `"type" text NOT NULL, ` +
        `"payload" jsonb NOT NULL DEFAULT '{}'::jsonb, ` +
        `"status" text NOT NULL DEFAULT 'pending', ` +
        `"processed" integer NOT NULL DEFAULT '0', ` +
        `"worker_id" text, ` +
        `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "job_queue_type_length" CHECK (length(type) BETWEEN 1 AND 60), ` +
        `CONSTRAINT "job_queue_processed_non_negative" CHECK (processed >= 0), ` +
        `CONSTRAINT "job_queue_status_enum" CHECK (status IN ('pending', 'done')), ` +
        `CONSTRAINT "PK_276b4a8597badbcd15d9fae6115" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE INDEX "job_queue_pending_created_idx" ON "job_queue" ("created_at", "id") ` +
        `WHERE status = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "job_queue_pending_created_idx"`);
    await queryRunner.query(`DROP TABLE "job_queue"`);
  }
}
