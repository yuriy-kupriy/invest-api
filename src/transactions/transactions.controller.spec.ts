import { Test, TestingModule } from '@nestjs/testing';
import { Currency } from '@/domain/currency';
import { Transaction } from '@/domain/transaction';
import { CreateTransactionsDto } from './dto/create-transactions.dto';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

const expense: Transaction = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  account_id: '11111111-1111-4111-8111-111111111111',
  type: 'expense',
  amount_cents: 4599,
  currency: Currency.UAH,
  occurred_at: '2026-08-20T12:30:00.000Z',
  description: 'Coffee',
  instrument_symbol: null,
  quantity_micro: null,
  created_at: '2026-08-20T12:31:00.000Z',
};

describe('TransactionsController', () => {
  let controller: TransactionsController;
  let transactionsService: jest.Mocked<Pick<TransactionsService, 'list' | 'create' | 'getById'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        {
          provide: TransactionsService,
          useValue: {
            list: jest.fn(),
            create: jest.fn(),
            getById: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(TransactionsController);
    transactionsService = module.get(TransactionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('list forwards query fields to the service', () => {
    const page = { items: [expense], next_cursor: null };
    transactionsService.list.mockReturnValue(page);

    expect(
      controller.list({
        limit: 10,
        cursor: 'tok',
        account_id: expense.account_id,
      }),
    ).toBe(page);
    expect(transactionsService.list).toHaveBeenCalledWith(10, 'tok', expense.account_id);
  });

  it('create returns the batch from the service', () => {
    const batch = { transactions: [expense] };
    transactionsService.create.mockReturnValue(batch);
    const dto: CreateTransactionsDto = {
      entries: [
        {
          account_id: expense.account_id,
          type: 'expense',
          amount_cents: 4599,
          currency: Currency.UAH,
          occurred_at: expense.occurred_at,
        },
      ],
    };

    expect(controller.create(dto)).toBe(batch);
    expect(transactionsService.create).toHaveBeenCalledWith(dto);
  });

  it('get passes transaction_id to the service', () => {
    transactionsService.getById.mockReturnValue(expense);

    expect(controller.get({ transaction_id: expense.id })).toBe(expense);
    expect(transactionsService.getById).toHaveBeenCalledWith(expense.id);
  });
});
