import { Currency } from './currency';

export const ACCOUNT_TYPES = ['cash', 'bank', 'brokerage', 'property'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: Currency;
  balance_cents: number;
  created_at: string;
}

export interface AccountPage {
  items: Account[];
  next_cursor: string | null;
}
