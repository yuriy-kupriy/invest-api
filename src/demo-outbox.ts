import { randomUUID } from 'node:crypto';
import {
  finish,
  orderCount,
  outboxCounts,
  placeOrder,
  processedCount,
  queueDepths,
  receiptCount,
  runDemo,
  waitFor,
} from './demo-broker-kit';

/**
 * HW #22 demo:outbox — happy path plus the Idempotency-Key. Two checkouts with
 * the SAME key race each other: one writes the order and its outbox row in one
 * COMMIT, the other waits on the key and replays the stored result. The relay
 * (a separate process) publishes the one event, the consumer applies it once.
 */
runDemo(async (demo) => {
  const key = randomUUID();
  const replies = await Promise.all([
    placeOrder(demo, { idempotencyKey: key }),
    placeOrder(demo, { idempotencyKey: key }),
  ]);
  const requests = replies.length;
  const replayed = replies.filter((r) => r.replayed).length;
  console.log(`two requests, key ${key}: orders ${replies.map((r) => r.orderId).join(' / ')}, replayed=${replayed}`);

  const consumer = demo.spawnConsumer();
  demo.spawnRelay();
  await waitFor('the event to be applied', () => consumer.count('acked') >= 1);
  await waitFor('the relay to mark it published', async () => (await outboxCounts(demo.ds)).published >= 1);

  const orders = await orderCount(demo.ds);
  const { outbox, published } = await outboxCounts(demo.ds);
  const deliveries = consumer.count('delivered');
  const effect = await receiptCount(demo.ds);
  const processed = await processedCount(demo.ds);
  const { work, dlq } = await queueDepths(demo.ch);

  finish({ requests, replayed, orders, outbox, published, deliveries, effect, processed, work, dlq }, [
    replies[0].orderId !== replies[1].orderId && `the two requests got different orders`,
    replayed !== 1 && `replayed ${replayed}, expected exactly one of the two`,
    orders !== 1 && `orders ${orders}, expected 1`,
    outbox !== 1 && `outbox ${outbox}, expected 1`,
    published !== 1 && `published ${published}, expected 1`,
    deliveries !== 1 && `deliveries ${deliveries}, expected 1`,
    effect !== 1 && `effect ${effect}, expected 1`,
    processed !== 1 && `processed ${processed}, expected 1`,
    work !== 0 && `work queue holds ${work}`,
    dlq !== 0 && `dlq holds ${dlq}`,
  ]);
});
