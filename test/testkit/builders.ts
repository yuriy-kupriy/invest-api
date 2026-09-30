import { randomUUID } from 'node:crypto';
import { Account } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { Transaction } from '@/domain/transaction';
import type { FxRateRow } from '@/fx-rates/nbu-client.service';

/**
 * Test data builders. Every default is valid on its own and unique per call, so
 * a test only spells out the field it is actually about — no wall of fixtures,
 * and no accidental collision with a row some other test left behind.
 */

/** Monotonic suffix, so each call's defaults differ from the last one's. */
let seq = 0;
const next = (): number => ++seq;

/** The UAH cash account db/dev-fixtures.sql seeds. */
export const CASH_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

export function anAccount(overrides: Partial<Account> = {}): Account {
  const n = next();
  return {
    id: randomUUID(),
    name: `Builder account ${n}`,
    type: 'cash',
    currency: Currency.UAH,
    balance_cents: 100_000,
    created_at: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
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
 * Defaults to a UAH expense on the seeded cash account: UAH keeps the resolved
 * fx_rate at 1 (transactions_base_currency_rate_is_one), and an expense needs
 * no instrument (transactions_instrument_matches_type).
 */
export function aTransaction(overrides: Partial<Transaction> = {}): Transaction {
  const n = next();
  const at = new Date(Date.UTC(2026, 7, 20) + n * 1000).toISOString();
  return {
    id: randomUUID(),
    account_id: CASH_ACCOUNT_ID,
    type: 'expense',
    amount_cents: 1000 + n,
    currency: Currency.UAH,
    booked_at: at,
    created_at: at,
    description: `Builder transaction ${n}`,
    instrument_symbol: null,
    quantity_micro: null,
    ...overrides,
  };
}
