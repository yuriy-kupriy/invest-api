import { randomUUID } from 'node:crypto';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';
import type { FxRateRow } from '@/fx-rates/nbu-client.service';
import type { TransactionEntryDto } from '@/transactions/dto/create-transactions.dto';

/**
 * Test data builders. Every default is valid on its own and unique per call, so
 * a test only spells out the field it is actually about — no wall of fixtures,
 * and no accidental collision with a row some other test left behind.
 */

/** Monotonic suffix for the columns that carry a UNIQUE constraint. */
let seq = 0;
const next = (): number => ++seq;

export const SEED_USER_ID = '00000001-0000-4000-8000-000000000001';
export const CASH_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

export interface UserRow {
  id: string;
  email: string;
  display_name: string;
}

export function aUser(overrides: Partial<UserRow> = {}): UserRow {
  const n = next();
  return {
    id: randomUUID(),
    email: `builder-${n}@example.com`,
    display_name: `Builder User ${n}`,
    ...overrides,
  };
}

export function anAccount(overrides: Partial<Account> = {}): Account {
  const n = next();
  return {
    id: randomUUID(),
    name: `Builder account ${n}`,
    type: 'cash',
    currency: Currency.UAH,
    balance_cents: 100_000,
    // Distinct and strictly increasing, so keyset pagination over
    // (created_at DESC, id DESC) has something deterministic to order by.
    created_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
    ...overrides,
  };
}

export interface InstrumentRow {
  id: string;
  symbol: string;
  name: string;
  asset_class: 'equity' | 'etf' | 'bond' | 'crypto';
  currency: string;
}

export function anInstrument(overrides: Partial<InstrumentRow> = {}): InstrumentRow {
  const n = next();
  return {
    id: randomUUID(),
    // instruments_symbol_format allows [A-Z0-9.-]{1,20} only.
    symbol: `BLD${n}`,
    name: `Builder instrument ${n}`,
    asset_class: 'etf',
    currency: 'USD',
    ...overrides,
  };
}

export function anFxRate(overrides: Partial<FxRateRow> = {}): FxRateRow {
  return {
    currency: 'USD',
    rateDate: '2026-02-01',
    rawRate: '41.5',
    rawUnits: 1,
    ...overrides,
  };
}

/**
 * A `POST /transactions` entry. fx_rate is not part of the wire shape — the
 * repository resolves it — but `currency: 'UAH'` keeps the resolved rate at 1,
 * which is what transactions_base_currency_rate_is_one demands.
 */
export function anEntry(overrides: Partial<TransactionEntryDto> = {}): TransactionEntryDto {
  const n = next();
  return {
    account_id: CASH_ACCOUNT_ID,
    type: 'expense',
    amount_cents: 1000 + n,
    currency: Currency.UAH,
    booked_at: new Date(Date.UTC(2026, 1, 1) + n * 1000).toISOString(),
    description: `Builder entry ${n}`,
    ...overrides,
  } as TransactionEntryDto;
}
