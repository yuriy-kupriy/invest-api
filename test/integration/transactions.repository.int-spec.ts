import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { validateEnv } from '@/config/env.validation';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { Instrument } from '@/entities/instrument.entity';
import { Transaction as TransactionEntity } from '@/entities/transaction.entity';
import { FxRatesModule } from '@/fx-rates/fx-rates.module';
import { Currency } from '@/domain/currency';
import { TransactionsRepository } from '@/transactions/transactions.repository';
import { aTransaction } from '../testkit/builders';
import { connect, resetDb } from '../testkit/db';

const BROKERAGE_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';


/**
 * The batch write path from HW #14, against the real table. The two things
 * worth a container are the JOIN that turns instrument_id back into a symbol,
 * and the composite foreign key (account_id, currency) → accounts (id,
 * currency) — an invariant that exists only in the database and that no unit
 * test with a mocked repository can reach.
 */
describe('TransactionsRepository (integration)', () => {
  let moduleRef: TestingModule;
  let repo: TransactionsRepository;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await connect();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        AppTypeOrmModule,
        FxRatesModule,
        TypeOrmModule.forFeature([TransactionEntity, Instrument]),
      ],
      providers: [TransactionsRepository],
    }).compile();
    repo = moduleRef.get(TransactionsRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
    await ds.destroy();
  });

  beforeEach(async () => {
    await resetDb(ds);
  });

  it('writes a batch in one insert and reads the instrument back through the join', async () => {
    const expense = aTransaction();
    const buy = aTransaction({
      account_id: BROKERAGE_ACCOUNT_ID,
      currency: Currency.USD,
      type: 'buy',
      instrument_symbol: 'VOO',
      quantity_micro: 10_000_000,
      booked_at: '2026-08-21T14:00:00.000Z',
    });

    await ds.manager.transaction(async (manager) => {
      await repo.saveMany([expense, buy], manager);
    });

    // instrument_symbol is not a column — it comes from relations: { instrument: true }.
    expect(await repo.findById(buy.id)).toMatchObject({
      instrument_symbol: 'VOO',
      quantity_micro: 10_000_000,
    });
    expect(await repo.findById(expense.id)).toMatchObject({ instrument_symbol: null });

    const page = await repo.findPage(10, undefined, BROKERAGE_ACCOUNT_ID);
    expect(page.map((t) => t.id)).toContain(buy.id);
    expect(page.map((t) => t.id)).not.toContain(expense.id);
  });

  it('reports an unknown symbol as 422 rather than letting a check constraint surface as a 500', async () => {
    const unknown = aTransaction({ type: 'buy', instrument_symbol: 'NOSUCHTICKER' });

    await expect(
      ds.manager.transaction(async (manager) => {
        await repo.saveMany([unknown], manager);
      }),
    ).rejects.toMatchObject({
      code: 'instrument-not-found',
      status: 422,
      response: expect.stringContaining('NOSUCHTICKER'),
    });

    expect(await repo.findById(unknown.id)).toBeUndefined();
  });

  it('rejects a transaction whose currency differs from its account (composite foreign key)', async () => {
    // The cash account is UAH. A USD row on it is refused by
    // transactions_currency_matches_account, not by any service-layer check.
    await expect(
      ds.manager.transaction(async (manager) => {
        await repo.saveMany([aTransaction({ currency: Currency.USD })], manager);
      }),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'transactions_currency_matches_account',
    });
  });

  it('rolls the whole batch back when a later entry violates a constraint', async () => {
    const good = aTransaction({ description: 'survivor probe' });
    const bad = aTransaction({ currency: Currency.USD });

    await expect(
      ds.manager.transaction(async (manager) => {
        await repo.saveMany([good, bad], manager);
      }),
    ).rejects.toBeDefined();

    expect(await repo.findById(good.id)).toBeUndefined();
  });
});
