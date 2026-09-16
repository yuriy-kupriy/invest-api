import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * q1 (db/queries/q1.sql, the same shape as `GET /transactions?account_id=…`)
 * selects `id, account_id, type, amount_cents, currency, fx_rate, booked_at`.
 * The original `transactions_account_booked_idx (account_id, booked_at DESC,
 * id DESC)` covers only 3 of those 7 columns as key columns, so every matching
 * row still needed a heap visit for `type`/`amount_cents`/`currency`/`fx_rate`
 * — an Index Scan, not an Index Only Scan, and ~50 extra buffer reads for a
 * `LIMIT 50` page (see db/OPTIMIZATIONS.md's q1 "after": 53 buffers, only 3 of
 * which are the index itself).
 *
 * INCLUDE adds those four columns as non-key index payload: they don't affect
 * ordering or uniqueness, but Postgres can now answer the query from the index
 * alone. Postgres has no ALTER INDEX ... ADD INCLUDE, so this drops and
 * recreates it — cheap here (dev-sized data), and in prod this is exactly the
 * kind of change that would use CREATE INDEX CONCURRENTLY instead.
 */
export class TransactionsAccountBookedIndexCovering1789240000000 implements MigrationInterface {
  name = 'TransactionsAccountBookedIndexCovering1789240000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "transactions_account_booked_idx"`);
    await queryRunner.query(
      `CREATE INDEX "transactions_account_booked_idx" ON "transactions" ` +
        `("account_id", "booked_at" DESC, "id" DESC) ` +
        `INCLUDE ("type", "amount_cents", "currency", "fx_rate")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "transactions_account_booked_idx"`);
    await queryRunner.query(
      `CREATE INDEX "transactions_account_booked_idx" ON "transactions" ` +
        `("account_id", "booked_at" DESC, "id" DESC)`,
    );
  }
}
