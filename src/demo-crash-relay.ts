import {
  finish,
  outboxCounts,
  placeOrder,
  processedCount,
  queueDepths,
  receiptCount,
  runDemo,
  waitFor,
} from './demo-broker-kit';

/**
 * HW #22 demo:crash-relay — the SERVICE write fails. Relay #1 publishes the
 * event, gets the broker's confirm and is SIGKILLed before UPDATE published_at
 * (a real kill -9 of a child process: the OS closes its DB socket and Postgres
 * rolls the open transaction back, so the row is unpublished again). Relay #2
 * publishes the same event a second time. The consumer gets it twice and
 * applies it once: at-least-once delivery + idempotent effect.
 */
runDemo(async (demo) => {
  await placeOrder(demo);
  const consumer = demo.spawnConsumer();

  const first = demo.spawnRelay({ CRASH_AFTER_PUBLISH: '1' });
  const signal = await first.exited;
  const markedAfterCrash = (await outboxCounts(demo.ds)).published;
  console.log(`relay #1 died of ${signal}; outbox rows marked published after the crash: ${markedAfterCrash}`);

  const second = demo.spawnRelay();
  await waitFor('both deliveries to be acked', () => consumer.count('acked') >= 2);
  await waitFor('relay #2 to mark the row', async () => (await outboxCounts(demo.ds)).published >= 1);

  const published = first.count('published') + second.count('published');
  const marked = (await outboxCounts(demo.ds)).published;
  const deliveries = consumer.count('delivered');
  const applied = consumer.count('acked', 'outcome=applied');
  const skipped = consumer.count('acked', 'outcome=duplicate');
  const effect = await receiptCount(demo.ds);
  const processed = await processedCount(demo.ds);
  const { work, dlq } = await queueDepths(demo.ch);

  finish({ published, marked, deliveries, applied, skipped, effect, processed, work, dlq }, [
    signal !== 'SIGKILL' && `relay #1 exited with ${signal}, expected SIGKILL`,
    markedAfterCrash !== 0 && `the row was marked before the crash (${markedAfterCrash}), so nothing was proven`,
    published < 2 && `published ${published}: the event was not republished`,
    marked !== 1 && `marked ${marked}, expected 1`,
    deliveries < 2 && `deliveries ${deliveries}: no duplicate reached the consumer`,
    applied !== 1 && `applied ${applied}, expected 1`,
    skipped !== deliveries - 1 && `skipped ${skipped}, expected ${deliveries - 1}`,
    effect !== 1 && `effect ${effect}, expected 1`,
    processed !== 1 && `processed ${processed}, expected 1`,
    work !== 0 && `work queue holds ${work}`,
    dlq !== 0 && `dlq holds ${dlq}`,
  ]);
});
