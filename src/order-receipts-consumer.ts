import { writeSync } from 'node:fs';
import { connect, ConsumeMessage } from 'amqplib';
import { DataSource } from 'typeorm';
import { OrderPlacedEvent, parseOrderPlaced } from './broker/order-placed.event';
import { assertTopology, brokerUrl, PREFETCH, RECEIPTS_QUEUE } from './broker/topology';
import { dataSourceOptions } from './data-source';

/**
 * HW #19 consumer of order.placed: issues one receipt per order. Runs as its own
 * process (`node dist/order-receipts-consumer.js`), which is what lets
 * demo:duplicate kill it for real.
 *
 * at-least-once in, exactly-once effect out:
 * - noAck: false, and the ack goes out only AFTER the receipt row is committed —
 *   a crash before the ack makes the broker redeliver, never lose;
 * - the receipt is INSERT … ON CONFLICT DO NOTHING on order_receipts' keys, so
 *   the redelivery finds the row and changes nothing.
 * The gap that remains: the row is committed but the ack is lost — harmless here
 * (the retry is a no-op), and HW #22 puts the mark and the effect in one COMMIT.
 */

// writeSync, not console.log: a pipe to the parent is asynchronous on macOS, and
// a SIGKILL right after a log line would take the unflushed line with it.
function report(line: string): void {
  writeSync(1, `consumer ${line}\n`);
}

/** true — receipt issued now; false — it already existed (a duplicate delivery). */
async function issueReceipt(ds: DataSource, event: OrderPlacedEvent): Promise<boolean> {
  const rows: unknown[] = await ds.query(
    `INSERT INTO order_receipts (order_id, event_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING
     RETURNING order_id`,
    [event.data.orderId, event.eventId],
  );
  return rows.length > 0;
}

async function main(): Promise<void> {
  const ds = await new DataSource(dataSourceOptions).initialize();
  const conn = await connect(brokerUrl());
  const ch = await conn.createChannel();
  await assertTopology(ch);
  await ch.prefetch(PREFETCH);

  // Fault injection for demo:duplicate: die like an OOM-killed pod — after the
  // effect, before the ack. The OS closes the socket; the broker requeues.
  const crashAfterEffect = process.env.CRASH_AFTER_EFFECT === '1';

  const handle = async (msg: ConsumeMessage | null): Promise<void> => {
    if (!msg) {
      // basic.cancel (queue deleted, consumer_timeout): every ack from here on
      // would go nowhere, so stop and let the supervisor restart us.
      report('cancelled by the broker');
      process.exit(1);
    }
    report(`delivered messageId=${msg.properties.messageId ?? '-'} redelivered=${msg.fields.redelivered}`);

    const event = parseOrderPlaced(msg.content);
    if (!event) {
      // Poison: no retry will ever make it valid — straight to the DLQ.
      ch.reject(msg, false);
      report('rejected outcome=poison');
      return;
    }

    let applied: boolean;
    try {
      applied = await issueReceipt(ds, event);
    } catch (error) {
      // Transient (DB down, pool exhausted): back to the queue. reject, not nack:
      // reject counts towards x-delivery-limit, so the loop is bounded.
      console.error(error);
      ch.reject(msg, true);
      report('requeued outcome=error');
      return;
    }

    if (crashAfterEffect) {
      report('crashing before ack');
      process.kill(process.pid, 'SIGKILL');
    }
    ch.ack(msg);
    report(`acked outcome=${applied ? 'applied' : 'duplicate'}`);
  };

  await ch.consume(RECEIPTS_QUEUE, (msg) => void handle(msg), { noAck: false });
  report(`ready prefetch=${PREFETCH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
