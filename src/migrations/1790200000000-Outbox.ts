import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HW #22: transactional outbox, consumer inbox, server-side Idempotency-Key.
 *
 * outbox — checkout writes the event here in the SAME transaction as the order;
 * the relay (src/broker/relay.ts) moves it to the broker. Column roles are the
 * ones Debezium's Outbox Event Router reads, so a later switch to CDC does not
 * touch consumers. Debezium's default names have no underscore (aggregatetype,
 * aggregateid), so the connector needs them spelled out:
 *   route.by.field=aggregate_type  table.field.event.key=aggregate_id
 *   table.field.event.id=id        table.field.event.payload=payload
 *   id           — the event's eventId; the broker messageId, the consumer's dedup key;
 *   published_at — NULL = not yet relayed; what the relay filters on;
 *   attempts     — publish attempts, failed ones included.
 * No FK to the aggregate: the event is a fact that was announced, it does not
 * vanish with the row it was about.
 *
 * outbox_unpublished_idx is partial: the relay only ever scans unpublished rows,
 * and that set stays small while published ones pile up (until cleanup, README).
 *
 * processed_messages — the consumer's inbox. Its row and the effect commit in
 * one transaction; PK (message_id, consumer) so each consumer dedups on its own.
 *
 * idempotency_keys — level 3, the API edge: one key, one order. The key is
 * claimed first, the order and the response are filled in before COMMIT.
 * ON DELETE CASCADE lets the demos clean up by deleting their orders.
 */
export class Outbox1790200000000 implements MigrationInterface {
  name = 'Outbox1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outbox" (` +
        `"id" uuid NOT NULL, ` +
        `"aggregate_type" text NOT NULL, ` +
        `"aggregate_id" text NOT NULL, ` +
        `"type" text NOT NULL, ` +
        `"payload" jsonb NOT NULL, ` +
        `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"published_at" TIMESTAMP(3) WITH TIME ZONE, ` +
        `"attempts" integer NOT NULL DEFAULT 0, ` +
        `CONSTRAINT "outbox_pkey" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at", "id") WHERE "published_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "processed_messages" (` +
        `"message_id" uuid NOT NULL, ` +
        `"consumer" text NOT NULL, ` +
        `"processed_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("message_id", "consumer"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "idempotency_keys" (` +
        `"account_id" uuid NOT NULL, ` +
        `"key" text NOT NULL, ` +
        `"order_id" uuid, ` +
        `"response" jsonb, ` +
        `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("account_id", "key"), ` +
        `CONSTRAINT "idempotency_keys_order_fk" FOREIGN KEY ("order_id") ` +
        `REFERENCES "transactions"("id") ON DELETE CASCADE)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotency_keys"`);
    await queryRunner.query(`DROP TABLE "processed_messages"`);
    await queryRunner.query(`DROP TABLE "outbox"`);
  }
}
