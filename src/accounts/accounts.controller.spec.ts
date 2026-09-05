import { Test, TestingModule } from '@nestjs/testing';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

const cashAccount: Account = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cash UAH',
  type: 'cash',
  currency: Currency.UAH,
  balance_cents: 350000,
  created_at: '2026-01-10T09:00:00.000Z',
};

describe('AccountsController', () => {
  let controller: AccountsController;
  let accountsService: jest.Mocked<Pick<AccountsService, 'list' | 'create' | 'getById'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountsController],
      providers: [
        {
          provide: AccountsService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            getById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AccountsController);
    accountsService = module.get(AccountsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('list delegates limit and cursor to the service', () => {
    const page = { items: [cashAccount], next_cursor: null };
    accountsService.list.mockReturnValue(page);

    expect(controller.list({ limit: 2, cursor: 'abc' })).toBe(page);
    expect(accountsService.list).toHaveBeenCalledWith(2, 'abc');
  });

  it('create sets Location and returns the account', () => {
    accountsService.create.mockReturnValue(cashAccount);
    const res = { location: jest.fn() };

    const result = controller.create(
      {
        name: cashAccount.name,
        type: cashAccount.type,
        currency: cashAccount.currency,
        opening_balance_cents: 0,
      },
      res as never,
    );

    expect(result).toBe(cashAccount);
    expect(res.location).toHaveBeenCalledWith(`/accounts/${cashAccount.id}`);
  });

  it('get passes account_id to the service', () => {
    accountsService.getById.mockReturnValue(cashAccount);

    expect(controller.get({ account_id: cashAccount.id })).toBe(cashAccount);
    expect(accountsService.getById).toHaveBeenCalledWith(cashAccount.id);
  });
});
