import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { AuthUser } from '@/auth/auth.types';
import { assertOwner } from '@/auth/ownership';
import { TransactionType } from '@/domain/transaction';
import { TransactionStatus } from '@/entities/transaction.entity';
import { problem } from '@/shared/problem.exception';
import { SIGN } from '@/transactions/transactions.service';
import { OrderEventsService } from './order-events.service';

interface LockedOrder {
  status: TransactionStatus;
  type: TransactionType;
  amount_cents: string;
  account_id: string;
  user_id: string;
}

/** An order is a transactions row (HW #14's checkout writes them as `buy`). */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accountsRepo: AccountsRepository,
    private readonly orderEvents: OrderEventsService,
  ) {}

  /**
   * Row lock, ownership check, status write and the balance correction in one
   * DB transaction; the event goes out only after COMMIT, so a client is never
   * told about a status that was rolled back.
   */
  async changeStatus(
    orderId: string,
    status: TransactionStatus,
    user: AuthUser,
  ): Promise<{ id: string; status: TransactionStatus }> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const rows: LockedOrder[] = await manager.query(
        `SELECT t.status, t.type, t.amount_cents, t.account_id, a.user_id
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.id = $1
         FOR UPDATE OF t`,
        [orderId],
      );
      const order = rows[0];
      if (!order) {
        throw problem(HttpStatus.NOT_FOUND, 'order-not-found', `order ${orderId} was not found`);
      }
      assertOwner(order.user_id, user, `order ${orderId}`);
      if (order.status === status) {
        return false;
      }

      await manager.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [orderId, status]);
      // Only posted rows count towards the balance: crossing that line in either
      // direction books or un-books the amount.
      if ((order.status === 'posted') !== (status === 'posted')) {
        const booked = SIGN[order.type] * Number(order.amount_cents);
        await this.accountsRepo.updateBalance(order.account_id, status === 'posted' ? booked : -booked, manager);
      }
      return true;
    });

    if (changed) {
      this.orderEvents.publish(orderId, status);
    }
    return { id: orderId, status };
  }
}
