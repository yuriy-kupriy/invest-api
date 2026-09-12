import { Account } from '@/domain/account';
import { Transaction, TransactionResponse } from '@/domain/transaction';

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

/**
 * `drift` comes from the validated config (ConfigService → DRIFT), never from
 * process.env: the environment is read in exactly one place, the zod schema.
 */
export function toTransaction(transaction: Transaction, drift = false): TransactionResponse {
  return {
    id: transaction.id,
    account_id: transaction.account_id,
    type: transaction.type,
    ...(drift ? { amountCents: transaction.amount_cents } : { amount_cents: transaction.amount_cents }),
    currency: transaction.currency,
    created_at: transaction.created_at,
    occurred_at: transaction.occurred_at,
    description: transaction.description,
    quantity_micro: transaction.quantity_micro,
    instrument_symbol: transaction.instrument_symbol,
  };
}
