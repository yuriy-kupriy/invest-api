import { publishEvent } from './broker/publisher';
import { PREFETCH } from './broker/topology';
import { checkout } from './concurrency/checkout';
import {
  ACCOUNT_ID,
  closeDemo,
  Consumer,
  finish,
  INSTRUMENT_ID,
  MARKER,
  openDemo,
  queueDepths,
  receiptCount,
  runDemo,
  spawnConsumer,
  UNIT_PRICE_CENTS,
  waitFor,
} from './demo-broker-kit';

/**
 * HW #19 demo:publish — happy path. Five checkouts publish order.placed while
 * NO consumer is running: the broker keeps them (work=5 in between), then the
 * consumer starts, gets all five, applies five effects and acks five times.
 */
const ORDERS = 5;

runDemo(async () => {
  const demo = await openDemo();
  let running: Consumer | undefined;
  try {
    let published = 0;
    for (let i = 0; i < ORDERS; i++) {
      const result = await checkout(
        demo.ds,
        { accountId: ACCOUNT_ID, instrumentId: INSTRUMENT_ID, quantity: 1, unitPriceCents: UNIT_PRICE_CENTS, description: MARKER },
        async (event) => {
          await publishEvent(demo.ch, event);
          published++;
        },
      );
      if (!result.ok) throw new Error(`checkout rejected: ${result.reason}`);
    }
    const waiting = (await queueDepths(demo.ch)).work;
    console.log(`${published} published with no consumer running; queue holds ${waiting} — starting the consumer`);

    const consumer = (running = spawnConsumer());
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
  } finally {
    running?.stop();
    await closeDemo(demo);
  }
});
