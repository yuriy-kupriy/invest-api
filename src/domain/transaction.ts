import { Currency } from './currency';

export const TRANSACTION_TYPES = [
  'income',
  'expense',
  'transfer_in',
  'transfer_out',
  'buy',
  'sell',
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface Transaction {
  id: string;
  account_id: string;
  type: TransactionType;
  amount_cents: number;
  currency: Currency;
  occurred_at: string;
  description: string | null;
  instrument_symbol: string | null;
  quantity_micro: number | null;
  created_at: string;
}

export interface TransactionPage {
  items: TransactionResponse[];
  next_cursor: string | null;
}

export interface TransactionBatch {
  transactions: TransactionResponse[];
}

export type TransactionResponse = Omit<Transaction, 'amount_cents'> & {
  amount_cents?: number;
  amountCents?: number;
};
