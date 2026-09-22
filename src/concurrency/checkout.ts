import { DataSource, EntityManager } from 'typeorm';

/**
 * The domain's checkout: buy `quantity` units of an instrument out of an
 * account, in one transaction — debit the account, write the order, enqueue the
 * receipt job. Either all three land or none of them does, so an order can
 * never exist without its money movement or without its post-processing task.
 *
 * On the scarce resource. A marketplace checkout guards two counters: a
 * product's stock and the buyer's balance. This ledger has no inventory — the
 * only finite resource is cash, so "oversell" here is an overdraft, and the
 * single guarded decrement of accounts.balance_cents plays both roles. The
 * invariant the race demo asserts is the same shape: no row ever goes negative,
 * and exactly as many calls succeed as the starting balance covered.
 */
export interface CheckoutRequest {
  accountId: string;
  instrumentId: string;
  /** Units to buy. Whole units, > 0. */
  quantity: number;
  /** Price of one unit, in the account's minor units (cents). */
  unitPriceCents: number;
  /** Written to transactions.description — the demos use it to find their rows. */
  description?: string | null;
}

export type CheckoutRejection = 'insufficient_funds' | 'account_not_found' | 'no_fx_rate';

export interface CheckoutSuccess {
  ok: true;
  orderId: string;
  jobId: string;
  /** Balance after the debit, straight from the guarded UPDATE's RETURNING. */
  balanceCents: number;
  costCents: number;
}

export interface CheckoutFailure {
  ok: false;
  reason: CheckoutRejection;
}

export type CheckoutResult = CheckoutSuccess | CheckoutFailure;

/**
 * Thrown *inside* the transaction on every business rejection, and turned back
 * into a value by `checkout` once the rollback has happened. Returning a plain
 * `{ ok: false }` from the transaction callback would make TypeORM COMMIT — and
 * commit whatever the earlier steps had already written. Only a throw rolls back.
 */
class CheckoutRejected extends Error {
  constructor(readonly reason: CheckoutRejection) {
    super(reason);
    this.name = 'CheckoutRejected';
  }
}

interface DebitRow {
  balance_cents: string;
  currency: string;
}

/**
 * The guard. One statement is the check *and* the row lock: rows whose balance
 * is too small simply do not match, so the UPDATE reports 0 rows and there is no
 * window between reading the balance and writing it. A SELECT … FOR UPDATE
 * followed by an UPDATE would be correct too, but it needs two round trips and
 * puts the comparison in JavaScript, where a stale read can survive.
 */
async function debitAccount(
  manager: EntityManager,
  accountId: string,
  costCents: number,
): Promise<DebitRow> {
  // TypeORM's postgres driver returns [rows, affectedRowCount] for UPDATE and
  // DELETE (plain `rows` for SELECT and INSERT), so destructure rather than
  // treating the result as a row array — `result.length` on the tuple is 2 even
  // when the statement matched nothing.
  const [rows, affected]: [DebitRow[], number] = await manager.query(
    `UPDATE accounts SET balance_cents = balance_cents - $2
     WHERE id = $1 AND balance_cents >= $2
     RETURNING balance_cents, currency`,
    [accountId, costCents],
  );

  if (affected > 0) {
    return rows[0];
  }

  // Zero rows is either "not enough money" or "no such account" — tell them
  // apart so the caller isn't left guessing, then roll back either way.
  const exists: { id: string }[] = await manager.query(`SELECT id FROM accounts WHERE id = $1`, [
    accountId,
  ]);

  throw new CheckoutRejected(exists.length > 0 ? 'insufficient_funds' : 'account_not_found');
}

/**
 * transactions has a CHECK that fx_rate is 1 exactly for UAH rows, so a
 * non-UAH order needs a real rate from fx_rate. Read inside the transaction:
 * the rate that priced the order is the rate that gets stored with it.
 */
async function resolveFxRate(manager: EntityManager, currency: string): Promise<string> {
  if (currency === 'UAH') {
    return '1';
  }

  const rows: { rate: string }[] = await manager.query(
    `SELECT rate FROM fx_rate WHERE currency = $1 ORDER BY rate_date DESC, source ASC LIMIT 1`,
    [currency],
  );

  if (rows.length === 0) {
    throw new CheckoutRejected('no_fx_rate');
  }

  return rows[0].rate;
}

export async function checkout(
  dataSource: DataSource,
  request: CheckoutRequest,
): Promise<CheckoutResult> {
  const { accountId, instrumentId, quantity, unitPriceCents } = request;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`checkout: quantity must be a positive integer, got ${quantity}`);
  }

  const costCents = unitPriceCents * quantity;

  try {
    // One callback, one connection from the pool, one BEGIN…COMMIT. All four
    // statements below run on `manager`, so they share that single client.
    return await dataSource.transaction(async (manager): Promise<CheckoutSuccess> => {
      const debited = await debitAccount(manager, accountId, costCents);
      const fxRate = await resolveFxRate(manager, debited.currency);

      const orderRows: { id: string }[] = await manager.query(
        `INSERT INTO transactions
           (account_id, instrument_id, currency, type, status,
            amount_cents, fx_rate, quantity_micro, unit_price, booked_at, description)
         VALUES ($1, $2, $3, 'buy', 'posted', $4, $5, $6, $7, now(), $8)
         RETURNING id`,
        [
          accountId,
          instrumentId,
          debited.currency,
          costCents,
          fxRate,
          quantity * 1_000_000,
          (unitPriceCents / 100).toFixed(10),
          request.description ?? null,
        ],
      );

      const jobRows: { id: string }[] = await manager.query(
        `INSERT INTO job_queue (type, payload)
         VALUES ('order_receipt', $1::jsonb)
         RETURNING id`,
        [JSON.stringify({ order_id: orderRows[0].id, account_id: accountId })],
      );

      return {
        ok: true,
        orderId: orderRows[0].id,
        jobId: jobRows[0].id,
        balanceCents: Number(debited.balance_cents),
        costCents,
      };
    });
  } catch (error) {
    if (error instanceof CheckoutRejected) {
      return { ok: false, reason: error.reason };
    }

    throw error;
  }
}
