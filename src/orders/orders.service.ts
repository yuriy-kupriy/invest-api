import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { AuthUser } from '@/auth/auth.types';
import { assertOwner } from '@/auth/ownership';
import { SIGN } from '@/domain/transaction';
import { TransactionStatus } from '@/entities/transaction.entity';
import { problem } from '@/shared/problem.exception';
import { checkout, CheckoutRejection } from '@/concurrency/checkout';
import { OrderDto, OrderStatusDto, PlaceOrderDto } from './dto/order.dto';
import { OrderEventsService } from './order-events.service';
import { OrdersRepository } from './orders.repository';

/** An order is a transactions row (HW #14's checkout writes them as `buy`). */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly accountsRepo: AccountsRepository,
    private readonly ordersRepo: OrdersRepository,
    private readonly orderEvents: OrderEventsService,
  ) {}

  /**
   * Row lock, ownership check, status write and the balance correction in one
   * DB transaction; the event goes out only after COMMIT, so a client is never
   * told about a status that was rolled back.
   *
   * Two money rules: a settled order is final (the broker already moved the
   * trade, so un-booking it would hand the cost back for free), and booking a
   * buy again debits only what the balance covers, like checkout does.
   */
  async changeStatus(orderId: string, status: TransactionStatus, user: AuthUser): Promise<OrderStatusDto> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const order = await this.ordersRepo.lockForUpdate(orderId, manager);
      if (!order) {
        throw problem(HttpStatus.NOT_FOUND, 'order-not-found', `order ${orderId} was not found`);
      }
      assertOwner(order.user_id, user, `order ${orderId}`);
      if (order.status === status) {
        return false;
      }
      if (order.settled) {
        throw problem(HttpStatus.CONFLICT, 'order-settled', `order ${orderId} is settled; its status is final`);
      }

      await this.ordersRepo.setStatus(orderId, status, manager);
      // Only posted rows count towards the balance: crossing that line in either
      // direction books or un-books the amount.
      if ((order.status === 'posted') !== (status === 'posted')) {
        const booked = SIGN[order.type] * Number(order.amount_cents);
        const delta = status === 'posted' ? booked : -booked;
        if (!(await this.ordersRepo.applyBalanceDelta(order.account_id, delta, manager))) {
          throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'insufficient-funds', 'the account balance does not cover the order');
        }
      }
      return true;
    });

    if (changed) {
      this.orderEvents.publish(orderId, status);
    }
    return { id: orderId, status };
  }

  /**
   * The course contour's entry point: HW #14's checkout (guarded debit, order,
   * receipt job and order.placed in the outbox — one COMMIT) behind HTTP. The
   * Idempotency-Key is claimed inside that COMMIT, so a retry after a restart
   * still replays instead of buying twice.
   */
  async place(body: PlaceOrderDto, user: AuthUser, idempotencyKey: string): Promise<OrderDto> {
    const account = await this.accountsRepo.findById(body.account_id);
    if (!account) {
      throw problem(HttpStatus.NOT_FOUND, 'account-not-found', `account ${body.account_id} was not found`);
    }
    assertOwner(account.user_id, user, `account ${body.account_id}`);

    if (!(await this.ordersRepo.instrumentExists(body.instrument_id))) {
      throw problem(HttpStatus.NOT_FOUND, 'instrument-not-found', `instrument ${body.instrument_id} was not found`);
    }

    const result = await checkout(
      this.dataSource,
      {
        accountId: body.account_id,
        instrumentId: body.instrument_id,
        quantity: body.quantity,
        unitPriceCents: body.unit_price_cents,
      },
      { idempotencyKey },
    );
    if (!result.ok) {
      const [status, detail] = REJECTIONS[result.reason];
      throw problem(status, result.reason.replaceAll('_', '-'), detail);
    }
    return this.get(result.orderId, user);
  }

  /** The order with what the background (receipt) and the broker (settlement) did to it. */
  async get(orderId: string, user: AuthUser): Promise<OrderDto> {
    const row = await this.ordersRepo.findView(orderId);
    if (!row) {
      throw problem(HttpStatus.NOT_FOUND, 'order-not-found', `order ${orderId} was not found`);
    }
    assertOwner(row.user_id, user, `order ${orderId}`);
    return {
      id: row.id,
      account_id: row.account_id,
      instrument_id: row.instrument_id,
      status: row.status,
      amount_cents: Number(row.amount_cents),
      currency: row.currency,
      quantity_micro: Number(row.quantity_micro),
      receipt_issued_at: row.issued_at?.toISOString() ?? null,
      settled_at: row.settled_at?.toISOString() ?? null,
    };
  }
}

const REJECTIONS: Record<CheckoutRejection, [HttpStatus, string]> = {
  insufficient_funds: [HttpStatus.UNPROCESSABLE_ENTITY, 'the account balance does not cover the order'],
  account_not_found: [HttpStatus.NOT_FOUND, 'the account was not found'],
  no_fx_rate: [HttpStatus.UNPROCESSABLE_ENTITY, "no fx rate is stored for the account's currency"],
  idempotency_key_reuse: [HttpStatus.UNPROCESSABLE_ENTITY, 'this Idempotency-Key was already spent on a different order'],
};
