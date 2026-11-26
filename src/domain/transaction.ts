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

/** Direction of a booked amount on the account balance. */
export const SIGN: Record<TransactionType, 1 | -1> = {
  income: 1,
  transfer_in: 1,
  sell: 1,
  expense: -1,
  transfer_out: -1,
  buy: -1,
};

export interface Transaction {
  id: string;
  account_id: string;
  type: TransactionType;
  amount_cents: number;
  currency: Currency;
  created_at: string;
  booked_at: string;
  description: string | null;
  instrument_symbol: string | null;
  quantity_micro: number | null;
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
