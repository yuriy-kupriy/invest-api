import { Account } from '@/domain/account';
import { Transaction, TransactionResponse } from '@/domain/transaction';

const DRIFT = process.env.DRIFT === '1';

export function toAccount(account: Account): Account {
  return {
    id: account.id,
    name: account.name,
    type: account.type,
    currency: account.currency,
    created_at: account.created_at,
    balance_cents: account.balance_cents,
  };
}

export function toTransaction(transaction: Transaction): TransactionResponse {
  return {
    id: transaction.id,
    account_id: transaction.account_id,
    type: transaction.type,
    ...(DRIFT ? { amountCents: transaction.amount_cents } : { amount_cents: transaction.amount_cents }),
    currency: transaction.currency,
    created_at: transaction.created_at,
    occurred_at: transaction.occurred_at,
    description: transaction.description,
    quantity_micro: transaction.quantity_micro,
    instrument_symbol: transaction.instrument_symbol,
  };
}
