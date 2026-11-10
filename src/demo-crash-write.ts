import { relayBatch } from './broker/relay';
import { finish, orderCount, outboxCounts, placeOrder, queueDepths, receiptCount, runDemo, waitFor } from './demo-broker-kit';

/**
 * HW #22 demo:crash-write — the BUSINESS write fails. checkout's transaction
 * throws after the outbox INSERT (the beforeCommit seam): inside the
 * transaction the row is there, after the ROLLBACK both it and the order are
 * gone. The relay then finds nothing, so nothing reaches the broker or the
 * consumer — the event cannot outlive its order.
 */
runDemo(async (demo) => {
  let outboxInTx = 0;
  let writeFailed = 0;
  try {
    await placeOrder(demo, {
      beforeCommit: async (manager) => {
        const [{ count }]: { count: number }[] = await manager.query(`SELECT count(*)::int AS count FROM outbox`);
        outboxInTx = count;
        throw new Error('crash-write: the transaction dies after the outbox INSERT');
      },
    });
  } catch (error) {
    writeFailed++;
    console.log(`checkout failed: ${(error as Error).message}; outbox rows seen inside it: ${outboxInTx}`);
  }

  const consumer = demo.spawnConsumer();
  await waitFor('the consumer to be ready', () => consumer.count('ready') >= 1);
  const relayed = await relayBatch(demo.ds, demo.ch);

  const orders = await orderCount(demo.ds);
  const { outbox, published } = await outboxCounts(demo.ds);
  // Published messages are either delivered or still in the queue — both must be zero.
  const deliveries = consumer.count('delivered') + (await queueDepths(demo.ch)).work;
  const effect = await receiptCount(demo.ds);

  finish({ 'write-failed': writeFailed, 'outbox-in-tx': outboxInTx, orders, outbox, relayed, published, deliveries, effect }, [
    writeFailed !== 1 && `write-failed ${writeFailed}, expected 1`,
    outboxInTx !== 1 && `the outbox row was not written before the failure (${outboxInTx}), so nothing was proven`,
    orders !== 0 && `orders ${orders}: the order survived the rollback`,
    outbox !== 0 && `outbox ${outbox}: the event survived its order`,
    relayed !== 0 && `relay published ${relayed} event(s)`,
    published !== 0 && `published ${published}, expected 0`,
    deliveries !== 0 && `deliveries ${deliveries}, expected 0`,
    effect !== 0 && `effect ${effect}, expected 0`,
  ]);
});
