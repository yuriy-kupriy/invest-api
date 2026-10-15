import { randomUUID } from 'node:crypto';
import { DLQ, EXCHANGE, ORDER_PLACED } from './broker/topology';
import { closeDemo, Consumer, finish, openDemo, queueDepths, runDemo, spawnConsumer, waitFor } from './demo-broker-kit';

/**
 * HW #19 demo:dlq — one poison order.placed (the contract is broken: no valid
 * data.orderId). No retry can fix that, so the consumer rejects it with
 * requeue=false, the work queue's x-dead-letter-exchange routes it to the DLQ,
 * and the reason is read back from the x-death headers the broker stamped on it.
 */
const REASONS = ['rejected', 'expired', 'maxlen', 'delivery_limit'];

interface XDeath {
  reason: string;
  queue: string;
  count: number;
}

runDemo(async () => {
  const demo = await openDemo();
  let running: Consumer | undefined;
  try {
    const consumer = (running = spawnConsumer());
    const eventId = randomUUID();
    const poison = { eventId, type: ORDER_PLACED, occurredAt: new Date().toISOString(), data: { orderId: 'not-a-uuid' } };
    demo.ch.publish(EXCHANGE, ORDER_PLACED, Buffer.from(JSON.stringify(poison)), {
      persistent: true,
      mandatory: true,
      messageId: eventId,
    });
    await demo.ch.waitForConfirms();

    await waitFor('the poison message in the DLQ', async () => (await queueDepths(demo.ch)).dlq === 1);

    // Read it without consuming it: get, look at the headers, put it back.
    const dead = await demo.ch.get(DLQ, { noAck: false });
    if (!dead) throw new Error('DLQ reported a message but basic.get returned none');
    const headers = dead.properties.headers ?? {};
    const xDeath = (headers['x-death'] as XDeath[] | undefined)?.[0];
    const reason = String(headers['x-first-death-reason'] ?? xDeath?.reason ?? 'none');
    console.log(`x-death[0]: reason ${xDeath?.reason}, from queue ${xDeath?.queue}, count ${xDeath?.count}`);
    demo.ch.nack(dead, false, true);
    await waitFor('the DLQ message back to ready', async () => (await queueDepths(demo.ch)).dlq === 1);

    const [{ count: effect }]: { count: number }[] = await demo.ds.query(
      `SELECT count(*)::int AS count FROM order_receipts WHERE event_id = $1`,
      [eventId],
    );
    const { work, dlq } = await queueDepths(demo.ch);
    const rejected = consumer.count('rejected');

    finish({ rejected, work, dlq, 'dlq-reason': reason, effect }, [
      rejected !== 1 && `consumer rejected ${rejected}, expected 1`,
      work !== 0 && `work queue holds ${work}, expected 0`,
      dlq !== 1 && `dlq holds ${dlq}, expected 1`,
      !REASONS.includes(reason) && `dlq-reason "${reason}" is not a dead-letter reason`,
      reason !== 'rejected' && `dlq-reason ${reason}, expected rejected`,
      effect !== 0 && `poison produced ${effect} effect(s)`,
    ]);
  } finally {
    running?.stop();
    await closeDemo(demo);
  }
});
