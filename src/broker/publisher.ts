import { ConfirmChannel } from 'amqplib';
import { OrderPlacedEvent } from './order-placed.event';
import { EXCHANGE } from './topology';

/**
 * Resolves only once the broker has taken responsibility for the message:
 * a confirm channel turns "written to the socket" into "persisted by the
 * queue", and `mandatory` turns "no binding matched" from a silent drop into a
 * basic.return — which the broker sends before the confirm, so it is known by
 * the time waitForConfirms resolves.
 */
export async function publishEvent(ch: ConfirmChannel, event: OrderPlacedEvent): Promise<void> {
  let returned = false;
  const onReturn = (msg: { properties: { messageId?: string } }) => {
    if (msg.properties.messageId === event.eventId) returned = true;
  };
  ch.on('return', onReturn);
  try {
    ch.publish(EXCHANGE, event.type, Buffer.from(JSON.stringify(event)), {
      persistent: true,
      mandatory: true,
      messageId: event.eventId,
      type: event.type,
      contentType: 'application/json',
    });
    await ch.waitForConfirms();
  } finally {
    ch.off('return', onReturn);
  }
  if (returned) {
    throw new Error(`${event.type} ${event.eventId} was unroutable: no queue is bound to it`);
  }
}
