import { HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { AuthUser } from '@/auth/auth.types';
import { ProblemException } from '@/shared/problem.exception';
import { OrderEventsService } from './order-events.service';
import { LockedOrder, OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';

const ORDER = '00000018-0000-4000-8000-00000000000a';
const owner: AuthUser = { id: 'u1', role: 'member', jti: 'j', sid: 's', exp: 0 };

function setup(order: Partial<LockedOrder>, balanceCovers = true) {
  const locked: LockedOrder = {
    status: 'posted',
    type: 'buy',
    amount_cents: '20000',
    account_id: 'acc',
    user_id: owner.id,
    settled: false,
    ...order,
  };
  const repo = {
    lockForUpdate: jest.fn().mockResolvedValue(locked),
    setStatus: jest.fn(),
    applyBalanceDelta: jest.fn().mockResolvedValue(balanceCovers),
  };
  const dataSource = { transaction: (work: (m: unknown) => unknown) => work({}) } as unknown as DataSource;
  const events = new OrderEventsService();
  const publish = jest.spyOn(events, 'publish');
  const service = new OrdersService(
    dataSource,
    {} as AccountsRepository,
    repo as unknown as OrdersRepository,
    events,
  );
  return { service, repo, publish };
}

async function problemCode(promise: Promise<unknown>): Promise<[number, string]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProblemException);
  return [(error as ProblemException).getStatus(), (error as ProblemException).code];
}

describe('OrdersService.changeStatus', () => {
  it('un-books a posted buy before settlement and publishes after commit', async () => {
    const { service, repo, publish } = setup({ status: 'posted' });

    await service.changeStatus(ORDER, 'failed', owner);

    expect(repo.applyBalanceDelta).toHaveBeenCalledWith('acc', 20000, {});
    expect(publish).toHaveBeenCalledWith(ORDER, 'failed');
  });

  it('refuses any change to a settled order: no refund, no event', async () => {
    const { service, repo, publish } = setup({ status: 'posted', settled: true });

    expect(await problemCode(service.changeStatus(ORDER, 'failed', owner))).toEqual([
      HttpStatus.CONFLICT,
      'order-settled',
    ]);
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(repo.applyBalanceDelta).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not book a buy the balance cannot cover', async () => {
    const { service, repo, publish } = setup({ status: 'failed' }, false);

    expect(await problemCode(service.changeStatus(ORDER, 'posted', owner))).toEqual([
      HttpStatus.UNPROCESSABLE_ENTITY,
      'insufficient-funds',
    ]);
    expect(repo.applyBalanceDelta).toHaveBeenCalledWith('acc', -20000, {});
    expect(publish).not.toHaveBeenCalled();
  });

  it('leaves the balance alone between pending and failed', async () => {
    const { service, repo } = setup({ status: 'pending' });

    await service.changeStatus(ORDER, 'failed', owner);

    expect(repo.applyBalanceDelta).not.toHaveBeenCalled();
  });

  it("refuses someone else's order", async () => {
    const { service } = setup({ user_id: 'u2' });

    expect(await problemCode(service.changeStatus(ORDER, 'failed', owner))).toEqual([
      HttpStatus.FORBIDDEN,
      'forbidden',
    ]);
  });
});
