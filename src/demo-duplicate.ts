import { publishEvent } from './broker/publisher';
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
 * HW #19 demo:duplicate — the same event delivered twice, the effect applied
 * once. One checkout publishes order.placed; consumer #1 issues the receipt and
 * is SIGKILLed before its ack (a real crash: the OS closes the socket, not a
 * polite channel.close()). The broker redelivers to consumer #2, whose INSERT
 * hits order_receipts' key and does nothing — then acks.
 */
runDemo(async () => {
  const demo = await openDemo();
  let running: Consumer | undefined;
  try {
    const result = await checkout(
      demo.ds,
      { accountId: ACCOUNT_ID, instrumentId: INSTRUMENT_ID, quantity: 1, unitPriceCents: UNIT_PRICE_CENTS, description: MARKER },
      (event) => publishEvent(demo.ch, event),
    );
    if (!result.ok) throw new Error(`checkout rejected: ${result.reason}`);

    const first = (running = spawnConsumer({ CRASH_AFTER_EFFECT: '1' }));
    const signal = await first.exited;
    const effectAfterCrash = await receiptCount(demo.ds);
    console.log(`consumer #1 died of ${signal}; receipts after the crash: ${effectAfterCrash}`);

    const second = (running = spawnConsumer());
    await waitFor('the redelivery to be acked', () => second.count('acked') >= 1);

    const deliveries = first.count('delivered') + second.count('delivered');
    const redelivered = second.count('delivered', 'redelivered=true');
    const skipped = second.count('acked', 'outcome=duplicate');
    const effect = await receiptCount(demo.ds);
    const { work, dlq } = await queueDepths(demo.ch);

    finish({ deliveries, effect, skipped, redelivered, work, dlq }, [
      signal !== 'SIGKILL' && `consumer #1 exited with ${signal}, expected SIGKILL`,
      effectAfterCrash !== 1 && `consumer #1 did not apply the effect before dying (${effectAfterCrash})`,
      deliveries < 2 && `deliveries ${deliveries}: no duplicate happened, so nothing was proven`,
      redelivered !== 1 && `the second delivery was not flagged redelivered`,
      effect !== 1 && `effect ${effect}, expected exactly 1`,
      skipped !== 1 && `skipped ${skipped}, expected 1`,
      work !== 0 && `work queue holds ${work}`,
      dlq !== 0 && `dlq holds ${dlq}`,
    ]);
  } finally {
    running?.stop();
    await closeDemo(demo);
  }
});
