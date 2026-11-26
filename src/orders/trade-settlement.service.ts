import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { Env } from '@/config/env.schema';
import { problem } from '@/shared/problem.exception';
import { TradeSettledDto, TradeSettlementResultDto } from './dto/order.dto';
import { OrdersRepository } from './orders.repository';

const CONSUMER = 'trade-settlement';

/** `sha256=<hex>` over the raw body — the shape GitHub and most providers use. */
export function signTradeEvent(secret: string, rawBody: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * The broker confirms a trade settled. Three edge checks, in this order:
 * 1. the signature is over the bytes as sent (a re-serialised object would not
 *    match what the broker signed), compared in constant time;
 * 2. the event id is claimed in processed_messages — in Postgres, so a redelivery
 *    after our restart is still a duplicate;
 * 3. the order must still be booked (`posted`) and the amount must equal the one
 *    frozen at checkout; anything else rolls back the claim, so a resend works
 *    once the order is fixed — a cancelled order is never settled behind its back.
 * The settlement row itself is append-only: one per order, never updated.
 */
@Injectable()
export class TradeSettlementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService<Env, true>,
    private readonly ordersRepo: OrdersRepository,
  ) {}

  async settle(rawBody: Buffer | undefined, signature: string | undefined, event: TradeSettledDto): Promise<TradeSettlementResultDto> {
    const secret = this.config.get('TRADE_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      throw problem(HttpStatus.SERVICE_UNAVAILABLE, 'webhook-disabled', 'TRADE_WEBHOOK_SECRET is not configured');
    }
    const expected = Buffer.from(signTradeEvent(secret, rawBody ?? ''));
    const given = Buffer.from(signature ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw problem(HttpStatus.UNAUTHORIZED, 'invalid-signature', 'X-Signature does not match the request body');
    }

    return this.dataSource.transaction(async (manager) => {
      if (!(await this.ordersRepo.claimEvent(event.event_id, CONSUMER, manager))) {
        return { order_id: event.order_id, outcome: 'duplicate' as const };
      }

      const order = await this.ordersRepo.lockBuy(event.order_id, manager);
      if (!order) {
        throw problem(HttpStatus.NOT_FOUND, 'order-not-found', `order ${event.order_id} was not found`);
      }
      if (order.status !== 'posted') {
        throw problem(HttpStatus.CONFLICT, 'order-not-posted', `order ${event.order_id} is ${order.status}, not posted`);
      }
      if (Number(order.amount_cents) !== event.amount_cents) {
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'amount-mismatch',
          `settled ${event.amount_cents}, the order froze ${order.amount_cents}`,
        );
      }

      const settled = await this.ordersRepo.insertSettlement(event.order_id, event.event_id, event.amount_cents, manager);
      return { order_id: event.order_id, outcome: settled ? ('settled' as const) : ('already-settled' as const) };
    });
  }
}
