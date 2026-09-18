import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the "a transaction's currency must match its account's currency" rule
 * from the service layer into the database.
 *
 * Until now the only thing enforcing it was the check in
 * TransactionsService.create(); any other writer — the seed, psql, a future
 * endpoint — could book a USD transaction onto a UAH account, and the balance
 * arithmetic (plain amount_cents addition, no fx conversion) would silently add
 * cents to kopiyky.
 *
 * The composite FK needs a UNIQUE on the referenced pair, hence
 * accounts_id_currency_uk — redundant next to the primary key, but that is what
 * a composite FK requires. ON UPDATE RESTRICT states the other half of the
 * rule: an account's currency is immutable once it has transactions.
 *
 * NOTE for future migration:generate runs — the composite FK is not expressible
 * through entity decorators (the single-column relation FK is what TypeORM
 * knows about), so the generator may propose
 * `DROP CONSTRAINT "transactions_currency_matches_account"`. Delete that line
 * from the generated file. The UNIQUE is safe: it is declared on the entity via
 * @Unique('accounts_id_currency_uk', ['id', 'currency']).
 *
 * Tried instead of accepting this: giving `Transaction.account`'s `@JoinColumn`
 * a composite array (`[{account_id→id}, {currency→currency}]`) so TypeORM
 * would know about the FK. Measured with `typeorm schema:log`: it made drift
 * worse, not better — 3 statements instead of 1. TypeORM drops the original
 * single-column `account_id` FK, still doesn't recognize this hand-named
 * constraint (it generates its own `FK_...` name), and rebuilds the composite
 * FK with `ON UPDATE NO ACTION` — silently losing the `ON UPDATE RESTRICT`
 * that is the actual point of this migration (an account's currency becomes
 * immutable once it has transactions). Reverted; the one-line manual step
 * above stays the answer.
 */
export class AccountCurrencyGuard1789230000000 implements MigrationInterface {
  name = 'AccountCurrencyGuard1789230000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "accounts_id_currency_uk" UNIQUE ("id", "currency")`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_matches_account" ` +
        `FOREIGN KEY ("account_id", "currency") REFERENCES "accounts" ("id", "currency") ` +
        `ON DELETE CASCADE ON UPDATE RESTRICT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "transactions_currency_matches_account"`,
    );
    await queryRunner.query(`ALTER TABLE "accounts" DROP CONSTRAINT "accounts_id_currency_uk"`);
  }
}
