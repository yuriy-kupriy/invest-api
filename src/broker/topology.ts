import { Channel } from 'amqplib';
import { ORDER_PLACED } from './order-placed.event';

/**
 * HW #19 topology. Declared by the consumer side (the receipts consumer and the
 * demos acting as its bootstrap), never by the publisher: the publisher knows
 * the exchange and the routing key, not who listens. A routing key with no
 * matching binding is dropped by the broker — and still confirmed positively —
 * which is why the publisher also sets `mandatory` (see publisher.ts).
 */
export const EXCHANGE = 'invest.events';
export const RECEIPTS_QUEUE = 'orders.placed.receipts';
export const DLX = 'invest.events.dlx';
export const DLQ = 'orders.placed.receipts.dlq';

/**
 * Equal to the consumer's pg pool size (10, the default): each in-flight
 * message needs a pool client for its INSERT, so more unacked messages would
 * only queue for a connection. prefetch × processing time = 10 × ≤ 2 ms
 * (measured: 50 events acked in 51–102 ms), far below consumer_timeout (30 min).
 */
export const PREFETCH = 10;

/** A message that keeps failing transiently goes to the DLQ on its 6th delivery attempt. */
const DELIVERY_LIMIT = 5;

export function brokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url) {
    throw new Error('BROKER_URL is not set — it comes from the vault (HW #11), or export it with SKIP_VAULT=1.');
  }
  return url;
}

export async function assertTopology(ch: Channel): Promise<void> {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(DLX, 'fanout', { durable: true });

  await ch.assertQueue(DLQ, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(DLQ, DLX, '');

  // Queue arguments are immutable: changing any of these on an existing queue is
  // 406 PRECONDITION_FAILED, so a change means deleting the queue first.
  await ch.assertQueue(RECEIPTS_QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DLX,
      'x-delivery-limit': DELIVERY_LIMIT,
    },
  });
  await ch.bindQueue(RECEIPTS_QUEUE, EXCHANGE, ORDER_PLACED);
}
