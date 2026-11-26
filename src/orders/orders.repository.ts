import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { applyBalanceDelta } from '@/concurrency/checkout';
import { TransactionType } from '@/domain/transaction';
import { TransactionStatus } from '@/entities/transaction.entity';

export interface LockedOrder {
  status: TransactionStatus;
  type: TransactionType;
  amount_cents: string;
  account_id: string;
  user_id: string;
  settled: boolean;
}

export interface OrderRow {
  id: string;
  account_id: string;
  instrument_id: string;
  status: TransactionStatus;
  amount_cents: string;
  currency: string;
  quantity_micro: string;
  user_id: string;
  issued_at: Date | null;
  settled_at: Date | null;
}

/** An order is a `buy` row of transactions; this is the SQL behind OrdersService and TradeSettlementService. */
@Injectable()
export class OrdersRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Row lock on a buy order; the owner comes along for the ownership check. */
  async lockForUpdate(orderId: string, manager: EntityManager): Promise<LockedOrder | undefined> {
    const rows: Omit<LockedOrder, 'settled'>[] = await manager.query(
      `SELECT t.status, t.type, t.amount_cents, t.account_id, a.user_id
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.id = $1 AND t.type = 'buy'
       FOR UPDATE OF t`,
      [orderId],
    );
    if (!rows[0]) {
      return undefined;
    }
    // A separate statement on purpose: a SELECT that waited for the lock sees the
    // locked row as committed, but other tables as of its own start — an EXISTS in
    // the query above would miss a settlement the webhook committed while we waited.
    const settled: unknown[] = await manager.query(`SELECT 1 FROM order_settlements WHERE order_id = $1`, [orderId]);
    return { ...rows[0], settled: settled.length > 0 };
  }

  async setStatus(orderId: string, status: TransactionStatus, manager: EntityManager): Promise<void> {
    await manager.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [orderId, status]);
  }

  /** checkout's guarded balance change; false when a debit is not covered. */
  async applyBalanceDelta(accountId: string, delta: number, manager: EntityManager): Promise<boolean> {
    return (await applyBalanceDelta(manager, accountId, delta)) !== undefined;
  }

  async instrumentExists(instrumentId: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(`SELECT 1 FROM instruments WHERE id = $1`, [instrumentId]);
    return rows.length > 0;
  }

  /** The order with what the background (receipt) and the broker (settlement) did to it. */
  async findView(orderId: string): Promise<OrderRow | undefined> {
    const rows: OrderRow[] = await this.dataSource.query(
      `SELECT t.id, t.account_id, t.instrument_id, t.status, t.amount_cents, t.currency, t.quantity_micro,
              a.user_id, r.issued_at, s.settled_at
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       LEFT JOIN order_receipts r ON r.order_id = t.id
       LEFT JOIN order_settlements s ON s.order_id = t.id
       WHERE t.id = $1 AND t.type = 'buy'`,
      [orderId],
    );
    return rows[0];
  }

  /** Claims a broker event id in processed_messages; false means it was already handled. */
  async claimEvent(eventId: string, consumer: string, manager: EntityManager): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `INSERT INTO processed_messages (message_id, consumer) VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING message_id`,
      [eventId, consumer],
    );
    return rows.length > 0;
  }

  async lockBuy(
    orderId: string,
    manager: EntityManager,
  ): Promise<{ amount_cents: string; status: TransactionStatus } | undefined> {
    const rows: { amount_cents: string; status: TransactionStatus }[] = await manager.query(
      `SELECT amount_cents, status FROM transactions WHERE id = $1 AND type = 'buy' FOR UPDATE`,
      [orderId],
    );
    return rows[0];
  }

  /** Append-only: one settlement per order; false when the order already has one. */
  async insertSettlement(orderId: string, eventId: string, amountCents: number, manager: EntityManager): Promise<boolean> {
    const rows: unknown[] = await manager.query(
      `INSERT INTO order_settlements (order_id, event_id, amount_cents) VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING order_id`,
      [orderId, eventId, amountCents],
    );
    return rows.length > 0;
  }
}
