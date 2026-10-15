import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HW #19: the effect of the order.placed consumer — one receipt per order.
 *
 * The primary key IS the idempotency: the consumer writes with
 * INSERT … ON CONFLICT DO NOTHING, so a redelivered event (same order_id, same
 * event_id) hits the key and changes nothing. The key lives in Postgres, next
 * to the orders, so it survives a consumer restart and is shared by every
 * replica — an in-process Set would be neither.
 *
 * order_id is the natural key (one receipt per order, whatever the event id);
 * event_id is UNIQUE as well, so a re-published event is recognisable on its
 * own. ON DELETE CASCADE lets the demos clean up by deleting their orders.
 *
 * No entity: nothing reads this table through the ORM, the consumer and the
 * demos speak SQL to it.
 */
export class OrderReceipts1790100000000 implements MigrationInterface {
  name = 'OrderReceipts1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_receipts" (` +
        `"order_id" uuid NOT NULL, ` +
        `"event_id" uuid NOT NULL, ` +
        `"issued_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "order_receipts_event_id_key" UNIQUE ("event_id"), ` +
        `CONSTRAINT "order_receipts_pkey" PRIMARY KEY ("order_id"), ` +
        `CONSTRAINT "order_receipts_order_fk" FOREIGN KEY ("order_id") ` +
        `REFERENCES "transactions"("id") ON DELETE CASCADE)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_receipts"`);
  }
}
