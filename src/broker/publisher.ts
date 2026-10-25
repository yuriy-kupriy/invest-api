import { ConfirmChannel } from 'amqplib';
import { OrderPlacedEvent } from './order-placed.event';
import { EXCHANGE } from './topology';

/** messageIds the broker bounced back as unroutable, per channel — one 'return' listener each. */
const returnedByChannel = new WeakMap<ConfirmChannel, Set<string>>();

function returnedOn(ch: ConfirmChannel): Set<string> {
  let returned = returnedByChannel.get(ch);
  if (!returned) {
    const ids = (returned = new Set<string>());
    ch.on('return', (msg: { properties: { messageId?: string } }) => {
      if (msg.properties.messageId) ids.add(msg.properties.messageId);
    });
    returnedByChannel.set(ch, ids);
  }
  return returned;
}

/**
 * Resolves only once the broker has taken responsibility for THIS message: a
 * confirm channel turns "written to the socket" into "persisted by the queue",
 * and `mandatory` turns "no binding matched" from a silent drop into a
 * basic.return — which the broker sends before the confirm, so it is known by
 * the time this message's confirm callback fires. A per-message callback rather
 * than waitForConfirms, which would also wait for every other publish in flight.
 */
export async function publishEvent(ch: ConfirmChannel, event: OrderPlacedEvent): Promise<void> {
  const returned = returnedOn(ch);
  await new Promise<void>((resolve, reject) => {
    ch.publish(
      EXCHANGE,
      event.type,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, mandatory: true, messageId: event.eventId, type: event.type, contentType: 'application/json' },
      (error: unknown) => (error ? reject(error) : resolve()),
    );
  });
  if (returned.delete(event.eventId)) {
    throw new Error(`${event.type} ${event.eventId} was unroutable: no queue is bound to it`);
  }
}
