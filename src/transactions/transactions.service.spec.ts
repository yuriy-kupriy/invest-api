import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { Transaction } from '@/domain/transaction';
import { ProblemException } from '@/shared/problem.exception';
import { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

const cashAccount: Account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cash UAH',
  type: 'cash',
  currency: Currency.UAH,
  balance_cents: 350000,
  created_at: '2026-01-10T09:00:00.000Z',
};

const expense: Transaction = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  account_id: cashAccount.id,
  type: 'expense',
  amount_cents: 4599,
  currency: Currency.UAH,
  booked_at: '2026-08-20T12:30:00.000Z',
  description: 'Coffee',
  instrument_symbol: null,
  quantity_micro: null,
  created_at: '2026-08-20T12:31:00.000Z',
};

describe('TransactionsService', () => {
  let service: TransactionsService;
  let transactionsRepo: jest.Mocked<TransactionsRepository>;
  let accountsRepo: jest.Mocked<AccountsRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionsService,
        {
          provide: TransactionsRepository,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
            save: jest.fn((tx: Transaction) => Promise.resolve(tx)),
          },
        },
        {
          provide: AccountsRepository,
          useValue: {
            findById: jest.fn(),
            findAll: jest.fn(),
            save: jest.fn(),
            updateBalance: jest.fn(),
            has: jest.fn(),
          },
        },
        {
          // The service only asks the config for DRIFT; snake_case wire format
          // is the default, so the stub answers '0'.
          provide: ConfigService,
          useValue: { get: jest.fn(() => '0') },
        },
      ],
    }).compile();

    service = module.get(TransactionsService);
    transactionsRepo = module.get(TransactionsRepository);
    accountsRepo = module.get(AccountsRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('throws when account_id filter points to a missing account', async () => {
      accountsRepo.has.mockResolvedValue(false);

      await expect(service.list(20, undefined, cashAccount.id)).rejects.toThrow(ProblemException);
    });

    it('filters by account_id when the account exists', async () => {
      accountsRepo.has.mockResolvedValue(true);
      transactionsRepo.findAll.mockResolvedValue([expense]);

      const page = await service.list(20, undefined, cashAccount.id);

      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(expense.id);
      expect(page.next_cursor).toBeNull();
    });
  });

  describe('create', () => {
    it('saves the batch and decrements balance for expense', async () => {
      accountsRepo.findById.mockResolvedValue(cashAccount);

      const result = await service.create({
        entries: [
          {
            account_id: cashAccount.id,
            type: 'expense',
            amount_cents: 1250,
            currency: Currency.UAH,
            booked_at: '2026-08-25T10:00:00.000Z',
            description: 'Lunch',
          },
        ],
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        type: 'expense',
        amount_cents: 1250,
        currency: Currency.UAH,
      });
      expect(transactionsRepo.save).toHaveBeenCalledTimes(1);
      expect(accountsRepo.updateBalance).toHaveBeenCalledWith(cashAccount.id, -1250);
    });

    it('does not save anything when a later entry is invalid', async () => {
      accountsRepo.findById.mockResolvedValueOnce(cashAccount).mockResolvedValueOnce(undefined);

      await expect(
        service.create({
          entries: [
            {
              account_id: cashAccount.id,
              type: 'expense',
              amount_cents: 1,
              currency: Currency.UAH,
              booked_at: '2026-08-25T10:00:00.000Z',
            },
            {
              account_id: '00000000-0000-4000-8000-000000000000',
              type: 'expense',
              amount_cents: 1,
              currency: Currency.UAH,
              booked_at: '2026-08-25T10:00:00.000Z',
            },
          ],
        }),
      ).rejects.toThrow(ProblemException);

      expect(transactionsRepo.save).not.toHaveBeenCalled();
      expect(accountsRepo.updateBalance).not.toHaveBeenCalled();
    });

    it('throws currency-mismatch when entry currency differs from the account', async () => {
      accountsRepo.findById.mockResolvedValue(cashAccount);

      try {
        await service.create({
          entries: [
            {
              account_id: cashAccount.id,
              type: 'expense',
              amount_cents: 100,
              currency: Currency.USD,
              booked_at: '2026-08-25T10:00:00.000Z',
            },
          ],
        });
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect((err as ProblemException).code).toBe('currency-mismatch');
      }
    });
  });

  describe('getById', () => {
    it('returns the transaction when it exists', async () => {
      transactionsRepo.findById.mockResolvedValue(expense);

      expect(await service.getById(expense.id)).toMatchObject({
        id: expense.id,
        amount_cents: expense.amount_cents,
      });
    });

    it('throws when the transaction is missing', async () => {
      transactionsRepo.findById.mockResolvedValue(undefined);

      try {
        await service.getById('aaaaaaaa-0000-4000-8000-000000000099');
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).code).toBe('transaction-not-found');
      }
    });
  });
});
