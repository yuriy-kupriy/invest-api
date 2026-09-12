import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { ProblemException } from '@/shared/problem.exception';
import { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';

const cashAccount: Account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cash UAH',
  type: 'cash',
  currency: Currency.UAH,
  balance_cents: 350000,
  created_at: '2026-01-10T09:00:00.000Z',
};

const brokerageAccount: Account = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'IBKR brokerage',
  type: 'brokerage',
  currency: Currency.USD,
  balance_cents: 1250000,
  created_at: '2026-02-01T09:00:00.000Z',
};

describe('AccountsService', () => {
  let service: AccountsService;
  let accountsRepo: jest.Mocked<AccountsRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountsService,
        {
          provide: AccountsRepository,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
            save: jest.fn((account: Account) => Promise.resolve(account)),
            updateBalance: jest.fn(),
            has: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AccountsService);
    accountsRepo = module.get(AccountsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns accounts newest first and a next_cursor when the page is full', async () => {
      accountsRepo.findAll.mockResolvedValue([cashAccount, brokerageAccount]);

      const page = await service.list(1);

      expect(page.items).toEqual([brokerageAccount]);
      expect(page.next_cursor).toEqual(expect.any(String));
    });
  });

  describe('create', () => {
    it('saves an account with the opening balance', async () => {
      const created = await service.create({
        name: 'EUR cash',
        type: 'cash',
        currency: Currency.EUR,
        opening_balance_cents: 5000,
      });

      expect(accountsRepo.save).toHaveBeenCalledTimes(1);
      expect(created).toMatchObject({
        name: 'EUR cash',
        type: 'cash',
        currency: Currency.EUR,
        balance_cents: 5000,
      });
      expect(created.id).toEqual(expect.any(String));
    });
  });

  describe('getById', () => {
    it('returns the account when it exists', async () => {
      accountsRepo.findById.mockResolvedValue(cashAccount);

      expect(await service.getById(cashAccount.id)).toEqual(cashAccount);
    });

    it('throws ProblemException when the account is missing', async () => {
      accountsRepo.findById.mockResolvedValue(undefined);

      try {
        await service.getById('00000000-0000-4000-8000-000000000000');
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).getStatus()).toBe(HttpStatus.NOT_FOUND);
        expect((err as ProblemException).code).toBe('account-not-found');
      }
    });
  });
});
