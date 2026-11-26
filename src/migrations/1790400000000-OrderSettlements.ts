import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Course project: the effect of the broker's trade-settlement webhook — one
 * append-only settlement row per order. order_id is the primary key, so a second
 * settlement event for the same order changes nothing; event_id is UNIQUE so a
 * row names the delivery that wrote it. Dedup of the delivery itself lives in
 * processed_messages (consumer 'trade-settlement'), next to the RabbitMQ inbox.
 */
export class OrderSettlements1790400000000 implements MigrationInterface {
  name = 'OrderSettlements1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "order_settlements" (` +
        `"order_id" uuid NOT NULL, ` +
        `"event_id" uuid NOT NULL, ` +
        `"amount_cents" bigint NOT NULL, ` +
        `"settled_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "order_settlements_pkey" PRIMARY KEY ("order_id"), ` +
        `CONSTRAINT "order_settlements_event_id_key" UNIQUE ("event_id"), ` +
        `CONSTRAINT "order_settlements_amount_positive" CHECK ("amount_cents" > 0), ` +
        `CONSTRAINT "order_settlements_order_fk" FOREIGN KEY ("order_id") ` +
        `REFERENCES "transactions"("id") ON DELETE CASCADE)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_settlements"`);
  }
}
