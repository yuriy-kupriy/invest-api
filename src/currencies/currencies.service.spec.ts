import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { CurrencyInfo } from '@/domain/currency';
import { ProblemException } from '@/shared/problem.exception';
import { CurrenciesRepository } from './currencies.repository';
import { CurrenciesService } from './currencies.service';

const usd: CurrencyInfo = { code: 'USD', numeric_code: 840, exponent: 2, name: 'United States dollar' };

describe('CurrenciesService', () => {
  let service: CurrenciesService;
  let currenciesRepo: jest.Mocked<CurrenciesRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CurrenciesService,
        {
          provide: CurrenciesRepository,
          useValue: {
            findByCode: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(CurrenciesService);
    currenciesRepo = module.get(CurrenciesRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getByCode', () => {
    it('returns the currency when found', async () => {
      currenciesRepo.findByCode.mockResolvedValue(usd);

      expect(await service.getByCode('USD')).toEqual(usd);
      expect(currenciesRepo.findByCode).toHaveBeenCalledWith('USD');
    });

    it('throws ProblemException when the code is missing', async () => {
      currenciesRepo.findByCode.mockResolvedValue(undefined);

      const err = await service.getByCode('XXX').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProblemException);
      expect((err as ProblemException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((err as ProblemException).code).toBe('currency-not-found');
    });
  });
});
