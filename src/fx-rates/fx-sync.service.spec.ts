import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env.schema';
import { FxRateCache } from './fx-rate.cache';
import { FxRateRepository } from './fx-rate.repository';
import { FxSyncService } from './fx-sync.service';
import { NbuClient } from './nbu-client.service';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const currencies = [
  { code: 'USD', numericCode: 840 },
  { code: 'EUR', numericCode: 978 },
  { code: 'GBP', numericCode: 826 },
  { code: 'JPY', numericCode: 392 },
];

function makeConfig(overrides: Partial<Record<keyof Env, unknown>> = {}): ConfigService<Env, true> {
  const values: Record<string, unknown> = {
    FX_BACKFILL_FROM: '1999-01-01',
    DB_POOL_MAX: 10,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
}

describe('FxSyncService.sync', () => {
  let repo: jest.Mocked<FxRateRepository>;
  let cache: FxRateCache;
  let nbuClient: jest.Mocked<NbuClient>;

  beforeEach(() => {
    repo = {
      findQuotedCurrencies: jest.fn().mockResolvedValue(currencies),
      findLastDates: jest.fn().mockResolvedValue(new Map()),
      upsertMany: jest.fn().mockResolvedValue(undefined),
      findAllEffective: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<FxRateRepository>;
    cache = new FxRateCache();
    nbuClient = { fetchRates: jest.fn() } as unknown as jest.Mocked<NbuClient>;
  });

  it('runs currencies with bounded overlap instead of one at a time', async () => {
    const gates = currencies.map(() => deferred<void>());
    let inFlight = 0;
    let maxInFlight = 0;

    nbuClient.fetchRates.mockImplementation(async (currency) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const index = currencies.findIndex((c) => c.code === currency.code);
      await gates[index].promise;
      inFlight -= 1;
      return [];
    });

    const service = new FxSyncService(repo, cache, makeConfig(), nbuClient);
    const syncPromise = service.sync(2);

    // Give the microtask queue a turn so mergeMap has started as many
    // projections as its concurrency limit allows.
    await Promise.resolve();
    await Promise.resolve();

    expect(maxInFlight).toBe(2); // bounded, but not sequential (would be 1)
    gates.forEach((g) => g.resolve());
    await syncPromise;

    expect(nbuClient.fetchRates).toHaveBeenCalledTimes(currencies.length);
  });

  it('one currency failing does not stop the others from syncing', async () => {
    nbuClient.fetchRates.mockImplementation(async (currency) => {
      if (currency.code === 'EUR') throw new Error('NBU timeout');
      return [{ currency: currency.code, rateDate: '2026-01-01', rawRate: '1', rawUnits: 1 }];
    });

    const service = new FxSyncService(repo, cache, makeConfig(), nbuClient);
    await expect(service.sync(4)).resolves.toBeUndefined();

    expect(nbuClient.fetchRates).toHaveBeenCalledTimes(currencies.length);
    // 3 succeeding currencies each upsert once; EUR's failure never calls upsertMany for EUR.
    expect(repo.upsertMany).toHaveBeenCalledTimes(3);
  });

  it('resumes each currency from its own last stored date, or FX_BACKFILL_FROM otherwise', async () => {
    repo.findLastDates.mockResolvedValue(new Map([['USD', '2026-09-01']]));
    nbuClient.fetchRates.mockResolvedValue([]);

    const service = new FxSyncService(repo, cache, makeConfig(), nbuClient);
    await service.sync(4);

    const fromByCurrency = new Map(
      nbuClient.fetchRates.mock.calls.map(([currency, from]) => [currency.code, from]),
    );
    expect(fromByCurrency.get('USD')).toBe('2026-09-01');
    expect(fromByCurrency.get('EUR')).toBe('1999-01-01');
  });
});
