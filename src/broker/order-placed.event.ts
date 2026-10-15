import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * The order.placed contract — designed on purpose, not an ORM row spread into
 * JSON: consumers (this receipts one, HW #22's outbox relay, HW #23's BullMQ
 * worker) pin these fields, so renaming a column must not rename the event.
 *
 * eventId is generated once per event and reused on every republish of it:
 * it is how a consumer recognises a duplicate. Amounts are integer cents, as
 * everywhere else in the ledger.
 */
export const orderPlacedSchema = z.object({
  eventId: z.uuid(),
  type: z.literal('order.placed'),
  occurredAt: z.iso.datetime(),
  data: z.object({
    orderId: z.uuid(),
    accountId: z.uuid(),
    instrumentId: z.uuid(),
    quantity: z.number().int().positive(),
    costCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
  }),
});

export type OrderPlacedEvent = z.infer<typeof orderPlacedSchema>;

export function orderPlaced(data: OrderPlacedEvent['data']): OrderPlacedEvent {
  return { eventId: randomUUID(), type: 'order.placed', occurredAt: new Date().toISOString(), data };
}

/** undefined for anything that is not a valid order.placed — that is a poison message, not a retry. */
export function parseOrderPlaced(body: Buffer): OrderPlacedEvent | undefined {
  try {
    const parsed = orderPlacedSchema.safeParse(JSON.parse(body.toString('utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
