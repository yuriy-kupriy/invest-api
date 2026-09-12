import dataSource from './data-source';
import { Account, AccountType } from './entities/account.entity';
import { Category, CategoryKind } from './entities/category.entity';
import { Currency } from './entities/currency.entity';
import { FxRate } from './entities/fx-rate.entity';
import { AssetClass, Instrument } from './entities/instrument.entity';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { User } from './entities/user.entity';

/**
 * Deterministic UUID: no Math.random(), no Date.now(). `ns` separates entity
 * types so ids never collide across tables; `n` is a plain sequence number.
 */
function id(ns: number, n: number): string {
  return `${String(ns).padStart(8, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function bookedAt(dayOffset: number): Date {
  return new Date(Date.UTC(2026, 0, 1 + dayOffset, 9, 0, 0));
}

const currencies: Currency[] = (
  [
    ['UAH', 980, 2, 'Ukrainian hryvnia'],
    ['USD', 840, 2, 'United States dollar'],
    ['EUR', 978, 2, 'Euro'],
    ['GBP', 826, 2, 'British pound'],
    ['PLN', 985, 2, 'Polish zloty'],
    ['JPY', 392, 0, 'Japanese yen'],
  ] as const
).map(([code, numericCode, exponent, name]) =>
  Object.assign(new Currency(), { code, numericCode, exponent, name }),
);

const users: User[] = (
  [
    ['Olena Koval', 'user1@example.com'],
    ['Andriy Shevchenko', 'user2@example.com'],
    ['Iryna Bondarenko', 'user3@example.com'],
    ['Dmytro Melnyk', 'user4@example.com'],
    ['Nataliya Tkachenko', 'user5@example.com'],
    ['Serhiy Kravchenko', 'user6@example.com'],
    ['Oksana Oliynyk', 'user7@example.com'],
    ['Yuriy Honchar', 'user8@example.com'],
  ] as const
).map(([displayName, email], i) =>
  Object.assign(new User(), { id: id(1, i + 1), email, displayName }),
);

const accounts: Account[] = (
  [
    [1, 'UAH', 'Cash UAH', 'cash', 350000],
    [1, 'USD', 'IBKR brokerage', 'brokerage', 1250000],
    [2, 'UAH', 'Main card', 'bank', 820000],
    [2, 'EUR', 'Savings EUR', 'bank', 500000],
    [3, 'UAH', 'Cash wallet', 'cash', 120000],
    [3, 'USD', 'Interactive Brokers', 'brokerage', 3400000],
    [4, 'UAH', 'Salary card', 'bank', 990000],
    [4, 'EUR', 'Berlin account', 'bank', 275000],
    [5, 'UAH', 'Apartment fund', 'property', 9500000],
    [6, 'USD', 'Crypto & stocks', 'brokerage', 640000],
    [7, 'USD', 'Overseas account', 'bank', 180000],
    [8, 'UAH', 'Everyday cash', 'cash', 45000],
  ] as const
).map(([userIdx, currency, name, type, balanceCents], i) =>
  Object.assign(new Account(), {
    id: id(2, i + 1),
    userId: id(1, userIdx),
    currency,
    name,
    type: type as AccountType,
    balanceCents,
    isArchived: false,
  }),
);

const instruments: Instrument[] = (
  [
    ['AAPL', 'Apple Inc.', 'equity'],
    ['MSFT', 'Microsoft Corp.', 'equity'],
    ['VOO', 'Vanguard S&P 500 ETF', 'etf'],
    ['QQQ', 'Invesco QQQ Trust', 'etf'],
    ['BND', 'Vanguard Total Bond Market ETF', 'bond'],
    ['GOVT', 'iShares US Treasury Bond ETF', 'bond'],
    ['BTC', 'Bitcoin', 'crypto'],
    ['ETH', 'Ethereum', 'crypto'],
    ['NVDA', 'NVIDIA Corp.', 'equity'],
    ['VXUS', 'Vanguard Total International Stock ETF', 'etf'],
  ] as const
).map(([symbol, name, assetClass], i) =>
  Object.assign(new Instrument(), {
    id: id(3, i + 1),
    symbol,
    name,
    assetClass: assetClass as AssetClass,
    currency: 'USD',
  }),
);

const categories: Category[] = (
  [
    ['Salary', 'income'],
    ['Freelance', 'income'],
    ['Investment income', 'income'],
    ['Groceries', 'expense'],
    ['Utilities', 'expense'],
    ['Rent', 'expense'],
    ['Entertainment', 'expense'],
    ['Transport', 'expense'],
  ] as const
).map(([name, kind], i) =>
  Object.assign(new Category(), { id: id(4, i + 1), name, kind: kind as CategoryKind }),
);

const fxRate = (source: string, currency: string, rateDate: string, rawRate: string, rawUnits = 1): FxRate =>
  Object.assign(new FxRate(), { source, currency, rateDate, rawRate, rawUnits });

const fxRates: FxRate[] = [
  fxRate('seed', 'USD', '2026-01-01', '41.5000000000'),
  fxRate('seed', 'USD', '2026-01-02', '41.6000000000'),
  fxRate('seed', 'EUR', '2026-01-01', '45.0000000000'),
  fxRate('seed', 'EUR', '2026-01-02', '45.2000000000'),
  fxRate('seed', 'GBP', '2026-01-01', '52.8000000000'),
  fxRate('seed', 'GBP', '2026-01-02', '52.9000000000'),
  fxRate('seed', 'PLN', '2026-01-01', '10.4000000000'),
  fxRate('seed', 'PLN', '2026-01-02', '10.4500000000'),
  fxRate('seed', 'JPY', '2026-01-01', '27.7000000000', 100),
  fxRate('seed', 'JPY', '2026-01-02', '27.8000000000', 100),
  fxRate('seed-alt', 'USD', '2026-01-01', '41.4500000000'),
  fxRate('seed-alt', 'EUR', '2026-01-01', '44.9000000000'),
];

const accountCurrency = new Map(accounts.map((a) => [a.id, a.currency]));
const fxRateForCurrency: Record<string, string> = { UAH: '1', USD: '41.5000000000', EUR: '45.0000000000', GBP: '52.8000000000', PLN: '10.4000000000' };

interface TxSpec {
  accountIdx: number;
  type: TransactionType;
  amountCents: number;
  categoryIdx?: number;
  instrumentIdx?: number;
  quantityMicro?: number;
  unitPrice?: string;
  description: string;
  day: number;
}

const txSpecs: TxSpec[] = [
  { accountIdx: 1, type: 'income', amountCents: 990000, categoryIdx: 1, description: 'Monthly salary', day: 1 },
  { accountIdx: 1, type: 'expense', amountCents: 45990, categoryIdx: 4, description: 'Groceries', day: 2 },
  { accountIdx: 1, type: 'expense', amountCents: 120000, categoryIdx: 6, description: 'Rent', day: 3 },
  { accountIdx: 1, type: 'expense', amountCents: 8500, categoryIdx: 5, description: 'Electricity bill', day: 4 },
  { accountIdx: 1, type: 'expense', amountCents: 15000, categoryIdx: 8, description: 'Metro pass', day: 5 },
  { accountIdx: 2, type: 'buy', amountCents: 520000, instrumentIdx: 3, quantityMicro: 10000000, unitPrice: '52.0000000000', description: 'Bought 10 VOO shares', day: 6 },
  { accountIdx: 2, type: 'buy', amountCents: 180000, instrumentIdx: 1, quantityMicro: 1000000, unitPrice: '180.0000000000', description: 'Bought 1 AAPL share', day: 7 },
  { accountIdx: 2, type: 'sell', amountCents: 60000, instrumentIdx: 3, quantityMicro: 1000000, unitPrice: '60.0000000000', description: 'Sold 1 VOO share', day: 8 },
  { accountIdx: 3, type: 'income', amountCents: 850000, categoryIdx: 1, description: 'Monthly salary', day: 1 },
  { accountIdx: 3, type: 'expense', amountCents: 32000, categoryIdx: 4, description: 'Groceries', day: 3 },
  { accountIdx: 3, type: 'expense', amountCents: 9000, categoryIdx: 7, description: 'Cinema', day: 9 },
  { accountIdx: 4, type: 'transfer_in', amountCents: 200000, description: 'Transfer from savings', day: 10 },
  { accountIdx: 4, type: 'expense', amountCents: 12000, categoryIdx: 5, description: 'Internet bill', day: 11 },
  { accountIdx: 5, type: 'income', amountCents: 25000, categoryIdx: 2, description: 'Freelance gig', day: 5 },
  { accountIdx: 5, type: 'expense', amountCents: 18000, categoryIdx: 4, description: 'Groceries', day: 6 },
  { accountIdx: 6, type: 'buy', amountCents: 3400000, instrumentIdx: 9, quantityMicro: 10000000, unitPrice: '340.0000000000', description: 'Bought 10 NVDA shares', day: 12 },
  { accountIdx: 6, type: 'buy', amountCents: 190000, instrumentIdx: 5, quantityMicro: 200000000, unitPrice: '0.9500000000', description: 'Bought 200 BND units', day: 13 },
  { accountIdx: 6, type: 'sell', amountCents: 500000, instrumentIdx: 9, quantityMicro: 1000000, unitPrice: '500.0000000000', description: 'Sold 1 NVDA share', day: 14 },
  { accountIdx: 7, type: 'income', amountCents: 990000, categoryIdx: 1, description: 'Monthly salary', day: 1 },
  { accountIdx: 7, type: 'expense', amountCents: 250000, categoryIdx: 6, description: 'Rent', day: 3 },
  { accountIdx: 7, type: 'expense', amountCents: 40000, categoryIdx: 8, description: 'Fuel', day: 15 },
  { accountIdx: 8, type: 'expense', amountCents: 25000, categoryIdx: 7, description: 'Concert tickets', day: 16 },
  { accountIdx: 8, type: 'transfer_out', amountCents: 50000, description: 'Transfer to UAH account', day: 17 },
  { accountIdx: 9, type: 'expense', amountCents: 300000, categoryIdx: 6, description: 'Property tax', day: 18 },
  { accountIdx: 9, type: 'income', amountCents: 150000, categoryIdx: 2, description: 'Rental income', day: 19 },
  { accountIdx: 10, type: 'buy', amountCents: 640000, instrumentIdx: 7, quantityMicro: 10000000, unitPrice: '0.0640000000', description: 'Bought BTC', day: 20 },
  { accountIdx: 10, type: 'buy', amountCents: 120000, instrumentIdx: 8, quantityMicro: 500000000, unitPrice: '0.0024000000', description: 'Bought ETH', day: 21 },
  { accountIdx: 11, type: 'income', amountCents: 720000, categoryIdx: 1, description: 'Monthly salary', day: 1 },
  { accountIdx: 11, type: 'expense', amountCents: 210000, categoryIdx: 6, description: 'Rent', day: 3 },
  { accountIdx: 11, type: 'expense', amountCents: 30000, categoryIdx: 4, description: 'Groceries', day: 22 },
  { accountIdx: 12, type: 'income', amountCents: 15000, categoryIdx: 2, description: 'Small freelance job', day: 23 },
  { accountIdx: 12, type: 'expense', amountCents: 6000, categoryIdx: 8, description: 'Bus ticket', day: 24 },
  { accountIdx: 1, type: 'expense', amountCents: 22000, categoryIdx: 4, description: 'Groceries', day: 25 },
  { accountIdx: 3, type: 'expense', amountCents: 11000, categoryIdx: 5, description: 'Water bill', day: 26 },
  { accountIdx: 7, type: 'expense', amountCents: 19000, categoryIdx: 4, description: 'Groceries', day: 27 },
  { accountIdx: 9, type: 'expense', amountCents: 45000, categoryIdx: 5, description: 'Maintenance', day: 28 },
  { accountIdx: 2, type: 'expense', amountCents: 5000, categoryIdx: 8, description: 'Parking', day: 9 },
  { accountIdx: 4, type: 'income', amountCents: 60000, categoryIdx: 3, description: 'Dividend payout', day: 10 },
  { accountIdx: 6, type: 'income', amountCents: 80000, categoryIdx: 3, description: 'Dividend payout', day: 15 },
  { accountIdx: 11, type: 'expense', amountCents: 14000, categoryIdx: 7, description: 'Streaming subscription', day: 20 },
];

const transactions: Transaction[] = txSpecs.map((spec, i) => {
  const accountId = id(2, spec.accountIdx);
  const currency = accountCurrency.get(accountId)!;
  const fxRateValue = fxRateForCurrency[currency] ?? '1';

  return Object.assign(new Transaction(), {
    id: id(5, i + 1),
    accountId,
    instrumentId: spec.instrumentIdx ? id(3, spec.instrumentIdx) : null,
    categoryId: spec.categoryIdx ? id(4, spec.categoryIdx) : null,
    currency,
    type: spec.type,
    status: 'posted',
    amountCents: spec.amountCents,
    fxRate: fxRateValue,
    quantityMicro: spec.quantityMicro ?? null,
    unitPrice: spec.unitPrice ?? null,
    bookedAt: bookedAt(spec.day),
    description: spec.description,
  });
});

async function seed(): Promise<void> {
  await dataSource.initialize();

  try {
    await dataSource.getRepository(Currency).upsert(currencies, { conflictPaths: ['code'] });
    await dataSource.getRepository(User).upsert(users, { conflictPaths: ['id'] });
    await dataSource.getRepository(Instrument).upsert(instruments, { conflictPaths: ['id'] });
    await dataSource.getRepository(Category).upsert(categories, { conflictPaths: ['id'] });
    await dataSource.getRepository(Account).upsert(accounts, { conflictPaths: ['id'] });
    await dataSource
      .getRepository(FxRate)
      .upsert(fxRates, { conflictPaths: ['source', 'currency', 'rateDate'] });
    await dataSource.getRepository(Transaction).upsert(transactions, { conflictPaths: ['id'] });

    console.log(
      `Seeded ${currencies.length} currencies, ${users.length} users, ${instruments.length} instruments, ` +
        `${categories.length} categories, ${accounts.length} accounts, ${fxRates.length} fx_rate rows, ` +
        `${transactions.length} transactions.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
