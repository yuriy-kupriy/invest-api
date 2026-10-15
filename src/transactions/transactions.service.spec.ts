import { Test, TestingModule } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AccountsRepository } from '@/accounts/accounts.repository';
import { AuthUser } from '@/auth/auth.types';
import { OwnedAccount } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { Transaction } from '@/domain/transaction';
import { ProblemException } from '@/shared/problem.exception';
import { TransactionsRepository } from './transactions.repository';
import { TransactionsService } from './transactions.service';

const owner: AuthUser = {
  id: '00000001-0000-4000-8000-000000000001',
  role: 'member',
  jti: '00000009-0000-4000-8000-000000000001',
  sid: '00000009-0000-4000-8000-000000000002',
  exp: 0,
};
const stranger: AuthUser = { ...owner, id: '00000001-0000-4000-8000-000000000002' };

const cashAccount: OwnedAccount = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: owner.id,
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
            findPage: jest.fn(),
            saveMany: jest.fn((batch: Transaction[]) => Promise.resolve(batch)),
          },
        },
        {
          provide: AccountsRepository,
          useValue: {
            findById: jest.fn(),
            findByIds: jest.fn(),
            findPage: jest.fn(),
            save: jest.fn(),
            updateBalance: jest.fn(),
          },
        },
        {
          // create() runs the whole batch inside dataSource.transaction(); the
          // stub just invokes the callback with a dummy manager, so the unit
          // tests still exercise the ordering of reads, saves and balance
          // updates. Real rollback behaviour is covered by the e2e suite.
          provide: getDataSourceToken(),
          useValue: { transaction: jest.fn((cb: (m: unknown) => unknown) => cb({})) },
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
      accountsRepo.findById.mockResolvedValue(undefined);

      await expect(service.list(owner, 20, undefined, cashAccount.id)).rejects.toThrow(ProblemException);
    });

    it('answers 403 when account_id filter points to someone else\'s account', async () => {
      accountsRepo.findById.mockResolvedValue(cashAccount);

      await expect(service.list(stranger, 20, undefined, cashAccount.id)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
      expect(transactionsRepo.findPage).not.toHaveBeenCalled();
    });

    // The account_id filter, the ordering and the cursor are now part of the
    // SQL query (TransactionsRepository.findPage); the service's remaining job
    // is to pass them down and to decide whether a next_cursor is due.
    it('pushes the account_id filter down to the repository', async () => {
      accountsRepo.findById.mockResolvedValue(cashAccount);
      transactionsRepo.findPage.mockResolvedValue([expense]);

      const page = await service.list(owner, 20, undefined, cashAccount.id);

      expect(transactionsRepo.findPage).toHaveBeenCalledWith(owner.id, 20, undefined, cashAccount.id);
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe(expense.id);
      expect(page.next_cursor).toBeNull();
    });

    it('issues a next_cursor when the page comes back full', async () => {
      transactionsRepo.findPage.mockResolvedValue([expense]);

      const page = await service.list(owner, 1);

      expect(page.next_cursor).toEqual(expect.any(String));
    });
  });

  describe('create', () => {
    it('saves the batch and decrements balance for expense', async () => {
      accountsRepo.findByIds.mockResolvedValue([cashAccount]);

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
      }, owner);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]).toMatchObject({
        type: 'expense',
        amount_cents: 1250,
        currency: Currency.UAH,
      });
      expect(transactionsRepo.saveMany).toHaveBeenCalledTimes(1);
      // Third argument is the EntityManager of the surrounding DB transaction —
      // its presence is the point: the balance update shares the batch's rollback.
      expect(accountsRepo.updateBalance).toHaveBeenCalledWith(cashAccount.id, -1250, {});
    });

    it('does not save anything when a later entry is invalid', async () => {
      // findByIds resolves the whole batch's unique account_ids in one call —
      // the missing account simply isn't in the returned array.
      accountsRepo.findByIds.mockResolvedValue([cashAccount]);

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
        }, owner),
      ).rejects.toThrow(ProblemException);

      expect(transactionsRepo.saveMany).not.toHaveBeenCalled();
      expect(accountsRepo.updateBalance).not.toHaveBeenCalled();
    });

    it('throws currency-mismatch when entry currency differs from the account', async () => {
      accountsRepo.findByIds.mockResolvedValue([cashAccount]);

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
        }, owner);
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect((err as ProblemException).code).toBe('currency-mismatch');
      }
    });
  });

  describe('ownership', () => {
    it('refuses with 403 and writes nothing when an entry targets someone else\'s account', async () => {
      accountsRepo.findByIds.mockResolvedValue([cashAccount]);

      await expect(
        service.create(
          {
            entries: [
              {
                account_id: cashAccount.id,
                type: 'expense',
                amount_cents: 1,
                currency: Currency.UAH,
                booked_at: '2026-08-25T10:00:00.000Z',
              },
            ],
          },
          stranger,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      expect(transactionsRepo.saveMany).not.toHaveBeenCalled();
    });

    it('answers 403 for a transaction on someone else\'s account', async () => {
      transactionsRepo.findById.mockResolvedValue(expense);
      accountsRepo.findById.mockResolvedValue(cashAccount);

      await expect(service.getById(expense.id, stranger)).rejects.toMatchObject({
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('getById', () => {
    it('returns the transaction when it exists', async () => {
      transactionsRepo.findById.mockResolvedValue(expense);
      accountsRepo.findById.mockResolvedValue(cashAccount);

      expect(await service.getById(expense.id, owner)).toMatchObject({
        id: expense.id,
        amount_cents: expense.amount_cents,
      });
    });

    it('throws when the transaction is missing', async () => {
      transactionsRepo.findById.mockResolvedValue(undefined);

      try {
        await service.getById('aaaaaaaa-0000-4000-8000-000000000099', owner);
        throw new Error('expected ProblemException');
      } catch (err) {
        expect(err).toBeInstanceOf(ProblemException);
        expect((err as ProblemException).code).toBe('transaction-not-found');
      }
    });
  });
});
