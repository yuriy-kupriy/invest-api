import { ConfirmChannel } from 'amqplib';
import { DataSource } from 'typeorm';
import { OrderPlacedEvent } from './order-placed.event';
import { publishEvent } from './publisher';

/**
 * One relay pass over the outbox (HW #22): claim → publish → mark, in that order.
 *
 * FOR UPDATE SKIP LOCKED, not a bare FOR UPDATE: a second relay skips the rows
 * this one holds instead of queueing behind them, so relays run in parallel
 * without publishing the same row at the same time. ORDER BY only fixes the
 * order rows are CLAIMED in — with several relays nothing orders delivery.
 * The filter is published_at IS NULL, not "id > last seen": an id is taken at
 * INSERT but the row becomes visible at COMMIT, so a cursor would skip rows
 * committed out of order.
 *
 * publish BEFORE marking: a crash in between republishes (a duplicate, which the
 * consumer's processed_messages absorbs); the reverse order would mark an event
 * that never left (a loss, which nothing absorbs). A publish error is not proof
 * the message is absent either — the confirm may be what got lost — so the row
 * just stays unpublished and goes out again on the next pass.
 *
 * `onPublished` runs between the broker's confirm and the UPDATE — the exact
 * spot demo:crash-relay kills the process in.
 */
export async function relayBatch(
  ds: DataSource,
  ch: ConfirmChannel,
  limit = 100,
  onPublished?: (event: OrderPlacedEvent) => Promise<void> | void,
): Promise<number> {
  return ds.transaction(async (manager) => {
    const rows: { id: string; payload: OrderPlacedEvent }[] = await manager.query(
      `SELECT id, payload FROM outbox
       WHERE published_at IS NULL
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [limit],
    );

    let published = 0;
    for (const row of rows) {
      try {
        await publishEvent(ch, row.payload);
      } catch (error) {
        // Count the attempt, keep what this pass already published, retry the rest later.
        console.error(error);
        await manager.query(`UPDATE outbox SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        break;
      }
      await onPublished?.(row.payload);
      await manager.query(`UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
      published++;
    }
    return published;
  });
}
