import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Env } from '@/config/env.schema';
import { ProblemException } from '@/shared/problem.exception';
import { TradeSettledDto } from './dto/order.dto';
import { OrdersRepository } from './orders.repository';
import { signTradeEvent, TradeSettlementService } from './trade-settlement.service';

const SECRET = 'a-webhook-secret-of-32-characters';
const event: TradeSettledDto = {
  event_id: '00000020-0000-4000-8000-000000000001',
  order_id: '00000018-0000-4000-8000-00000000000a',
  amount_cents: 20000,
};
const raw = Buffer.from(JSON.stringify(event));

function setup(order: { amount_cents: string; status: string } | undefined = { amount_cents: '20000', status: 'posted' }) {
  const repo = {
    claimEvent: jest.fn().mockResolvedValue(true),
    lockBuy: jest.fn().mockResolvedValue(order),
    insertSettlement: jest.fn().mockResolvedValue(true),
  };
  const dataSource = { transaction: (work: (m: unknown) => unknown) => work({}) } as unknown as DataSource;
  const config = { get: () => SECRET } as unknown as ConfigService<Env, true>;
  return { service: new TradeSettlementService(dataSource, config, repo as unknown as OrdersRepository), repo };
}

async function problemCode(promise: Promise<unknown>): Promise<[number, string]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProblemException);
  return [(error as ProblemException).getStatus(), (error as ProblemException).code];
}

describe('TradeSettlementService.settle', () => {
  it('settles a posted order with a valid signature', async () => {
    const { service, repo } = setup();

    await expect(service.settle(raw, signTradeEvent(SECRET, raw), event)).resolves.toEqual({
      order_id: event.order_id,
      outcome: 'settled',
    });
    expect(repo.insertSettlement).toHaveBeenCalledWith(event.order_id, event.event_id, 20000, {});
  });

  it('rejects a signature over other bytes before touching the database', async () => {
    const { service, repo } = setup();

    expect(await problemCode(service.settle(raw, signTradeEvent(SECRET, '{}'), event))).toEqual([
      HttpStatus.UNAUTHORIZED,
      'invalid-signature',
    ]);
    expect(repo.claimEvent).not.toHaveBeenCalled();
  });

  it('answers a redelivered event as a duplicate', async () => {
    const { service, repo } = setup();
    repo.claimEvent.mockResolvedValue(false);

    await expect(service.settle(raw, signTradeEvent(SECRET, raw), event)).resolves.toMatchObject({
      outcome: 'duplicate',
    });
    expect(repo.lockBuy).not.toHaveBeenCalled();
  });

  it('refuses to settle an order that was un-booked', async () => {
    const { service, repo } = setup({ amount_cents: '20000', status: 'failed' });

    expect(await problemCode(service.settle(raw, signTradeEvent(SECRET, raw), event))).toEqual([
      HttpStatus.CONFLICT,
      'order-not-posted',
    ]);
    expect(repo.insertSettlement).not.toHaveBeenCalled();
  });

  it('refuses an amount that differs from the frozen one', async () => {
    const { service } = setup({ amount_cents: '19999', status: 'posted' });

    expect(await problemCode(service.settle(raw, signTradeEvent(SECRET, raw), event))).toEqual([
      HttpStatus.UNPROCESSABLE_ENTITY,
      'amount-mismatch',
    ]);
  });
});
