import { relayBatch } from './broker/relay';
import { PREFETCH } from './broker/topology';
import { finish, placeOrder, queueDepths, receiptCount, runDemo, waitFor } from './demo-broker-kit';

/**
 * HW #19 demo:publish — happy path. Five checkouts, then one outbox relay pass
 * (HW #22) publishes their order.placed while NO consumer is running: the
 * broker keeps them (work=5 in between), then the
 * consumer starts, gets all five, applies five effects and acks five times.
 */
const ORDERS = 5;

runDemo(async (demo) => {
  for (let i = 0; i < ORDERS; i++) await placeOrder(demo);
  const published = await relayBatch(demo.ds, demo.ch);
  const waiting = (await queueDepths(demo.ch)).work;
  console.log(`${published} published with no consumer running; queue holds ${waiting} — starting the consumer`);

  const consumer = demo.spawnConsumer();
  await waitFor(`${published} acks`, () => consumer.count('acked') >= published);

  const effect = await receiptCount(demo.ds);
  const { work, dlq } = await queueDepths(demo.ch);
  const delivered = consumer.count('delivered');
  const acked = consumer.count('acked');

  finish({ published, delivered, effect, acked, work, dlq, prefetch: PREFETCH }, [
    published !== ORDERS && `published ${published}, expected ${ORDERS}`,
    waiting !== published && `broker held ${waiting} of ${published} before the consumer started`,
    delivered !== published && `delivered ${delivered}, expected ${published}`,
    effect !== published && `effect ${effect}, expected ${published}`,
    acked !== published && `acked ${acked}, expected ${published}`,
    work !== 0 && `work queue still holds ${work}`,
    dlq !== 0 && `dlq holds ${dlq}, expected 0`,
  ]);
});
