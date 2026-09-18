import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ProblemException } from '@/shared/problem.exception';
import { FxRateCache } from './fx-rate.cache';
import { FxRateRepository } from './fx-rate.repository';
import { FxRatesService } from './fx-rates.service';

const on = new Date('2026-09-17T00:00:00.000Z');

function fxRateRow(currency: string, rate: string) {
  return { currency, rate, rateDate: '2026-09-17', source: 'nbu' };
}

describe('FxRatesService', () => {
  let service: FxRatesService;
  let fxRateRepo: jest.Mocked<FxRateRepository>;
  let cache: jest.Mocked<FxRateCache>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxRatesService,
        { provide: FxRateRepository, useValue: { findLatest: jest.fn() } },
        { provide: FxRateCache, useValue: { findLatest: jest.fn() } },
      ],
    }).compile();

    service = module.get(FxRatesService);
    fxRateRepo = module.get(FxRateRepository);
    cache = module.get(FxRateCache);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCrossRate', () => {
    it('triangulates through UAH: RON per unit divided by EUR per unit', async () => {
      // Real-shaped numbers: ~11.4 UAH/RON, ~51.4 UAH/EUR → ~0.2218 EUR per RON.
      cache.findLatest.mockImplementation((currency) =>
        currency === 'RON' ? fxRateRow('RON', '11.4000000000') : fxRateRow('EUR', '51.4490000000'),
      );

      const rate = await service.getCrossRate('RON', 'EUR', on);

      expect(Number(rate)).toBeCloseTo(11.4 / 51.449, 8);
    });

    it('returns "1" for the same currency on both sides without any lookup', async () => {
      const rate = await service.getCrossRate('EUR', 'EUR', on);

      expect(rate).toBe('1');
      expect(cache.findLatest).not.toHaveBeenCalled();
      expect(fxRateRepo.findLatest).not.toHaveBeenCalled();
    });

    it('uses the UAH shortcut for either leg instead of a lookup', async () => {
      cache.findLatest.mockReturnValue(fxRateRow('EUR', '51.4490000000'));

      const rate = await service.getCrossRate('UAH', 'EUR', on);

      // 1 UAH = 1/51.449 EUR.
      expect(Number(rate)).toBeCloseTo(1 / 51.449, 8);
    });

    it('propagates 422 fx-rate-unavailable when either leg has no rate', async () => {
      cache.findLatest.mockReturnValue(undefined);
      fxRateRepo.findLatest.mockResolvedValue(undefined);

      try {
        await service.getCrossRate('RON', 'EUR', on);
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect((err as ProblemException).code).toBe('fx-rate-unavailable');
      }
    });
  });
});
