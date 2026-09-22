import { DataSource } from 'typeorm';
import { checkout, CheckoutRejection } from './concurrency/checkout';
import { dataSourceOptions } from './data-source';

/**
 * HW #14 p.2 — the concurrent load script: 50 checkouts fired at once against a
 * resource that covers exactly 10 of them, with no application-side queue
 * anywhere (one Promise.all, nothing else).
 *
 * What plays "stock". This domain has no inventory; the finite resource is cash,
 * so the demo constrains the account balance instead of a stock column: the
 * account starts with exactly UNITS × PRICE, every call buys one unit, and
 * "oversell" would show up as a negative balance. The numbers line up with the
 * marketplace version one-for-one — 10 units available, 10 successes, 0 left,
 * 0 rows below zero — and the guard is the same atomic UPDATE … WHERE … >= $n
 * RETURNING inside the transaction (see src/concurrency/checkout.ts).
 */
const ATTEMPTS = 50;
const UNITS = 10;
const PRICE_CENTS = 12_000;
const START_BALANCE_CENTS = UNITS * PRICE_CENTS;

// Seeded by src/seed.ts: id(2, 2) is user1's USD brokerage account, id(3, 1) is
// AAPL (also USD, so the composite FK (account_id, currency) is satisfied).
const ACCOUNT_ID = '00000002-0000-4000-8000-000000000002';
const INSTRUMENT_ID = '00000003-0000-4000-8000-000000000001';
const MARKER = 'hw14 demo:race';

async function reset(dataSource: DataSource): Promise<void> {
  const existing: { id: string }[] = await dataSource.query(
    `SELECT id FROM accounts WHERE id = $1`,
    [ACCOUNT_ID],
  );

  if (existing.length === 0) {
    throw new Error(`Account ${ACCOUNT_ID} is missing — run "npm run seed" first.`);
  }

  // Undo the previous run, so the script is repeatable and the counts below
  // describe this run only.
  await dataSource.query(`DELETE FROM transactions WHERE description = $1`, [MARKER]);
  await dataSource.query(`DELETE FROM job_queue WHERE type = 'order_receipt'`);
  await dataSource.query(`UPDATE accounts SET balance_cents = $2 WHERE id = $1`, [
    ACCOUNT_ID,
    START_BALANCE_CENTS,
  ]);
}

async function main(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  try {
    await reset(dataSource);

    const startedAt = Date.now();

    // The whole point: no batching, no semaphore, no queue. 50 checkouts leave
    // at once and fight over one row. (They share the pool's connections, so
    // some of them wait for a client — that is the pool being polite, not the
    // application serialising the work.)
    const results = await Promise.all(
      Array.from({ length: ATTEMPTS }, () =>
        checkout(dataSource, {
          accountId: ACCOUNT_ID,
          instrumentId: INSTRUMENT_ID,
          quantity: 1,
          unitPriceCents: PRICE_CENTS,
          description: MARKER,
        }),
      ),
    );

    const elapsedMs = Date.now() - startedAt;

    const succeeded = results.filter((result) => result.ok).length;
    const rejections = new Map<CheckoutRejection, number>();
    for (const result of results) {
      if (!result.ok) {
        rejections.set(result.reason, (rejections.get(result.reason) ?? 0) + 1);
      }
    }

    const [{ balance_cents: finalBalanceRaw }]: { balance_cents: string }[] = await dataSource.query(
      `SELECT balance_cents FROM accounts WHERE id = $1`,
      [ACCOUNT_ID],
    );
    const finalBalance = Number(finalBalanceRaw);

    const [{ count: negativeRaw }]: { count: string }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM accounts WHERE balance_cents < 0`,
    );
    const negativeRows = Number(negativeRaw);

    const [{ count: ordersRaw }]: { count: string }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM transactions WHERE description = $1`,
      [MARKER],
    );
    const orders = Number(ordersRaw);

    const [{ count: jobsRaw }]: { count: string }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM job_queue WHERE type = 'order_receipt'`,
    );
    const jobs = Number(jobsRaw);

    console.log('Concurrent checkout — 50 parallel calls, one account, one unit each\n');
    console.log(`attempts (спроб):                 ${ATTEMPTS}`);
    console.log(`succeeded (успішних):             ${succeeded}`);
    for (const [reason, count] of [...rejections].sort()) {
      console.log(`rejected (${reason}):${' '.repeat(Math.max(1, 23 - reason.length))}${count}`);
    }
    console.log(
      `stock before (units affordable):  ${UNITS} (balance ${START_BALANCE_CENTS} cents @ ${PRICE_CENTS}/unit)`,
    );
    console.log(
      `final stock (фінальний stock):    ${Math.floor(finalBalance / PRICE_CENTS)} units (balance ${finalBalance} cents)`,
    );
    console.log(`rows with negative stock (відʼємний stock): ${negativeRows}`);
    console.log(`orders in transactions:           ${orders}`);
    console.log(`post-processing jobs queued:      ${jobs}`);
    console.log(`debited total:                    ${START_BALANCE_CENTS - finalBalance} cents`);
    console.log(`wall time:                        ${elapsedMs} ms`);

    // The script grades itself: every invariant that oversell or a lost update
    // would break is asserted here, so a regression fails the command.
    const problems: string[] = [];
    if (succeeded !== UNITS) {
      problems.push(`expected exactly ${UNITS} successful checkouts, got ${succeeded}`);
    }
    if (finalBalance !== 0) {
      problems.push(`expected final balance 0 (stock fully drawn down), got ${finalBalance}`);
    }
    if (negativeRows !== 0) {
      problems.push(`oversell: ${negativeRows} row(s) with a negative balance`);
    }
    if (orders !== succeeded) {
      problems.push(`orphan orders: ${orders} order rows for ${succeeded} successful checkouts`);
    }
    if (jobs !== succeeded) {
      problems.push(`queue drift: ${jobs} jobs for ${succeeded} successful checkouts`);
    }
    if (START_BALANCE_CENTS - finalBalance !== succeeded * PRICE_CENTS) {
      problems.push(
        `arithmetic: debited ${START_BALANCE_CENTS - finalBalance}, expected ${succeeded * PRICE_CENTS}`,
      );
    }

    if (problems.length > 0) {
      console.error('\nFAILED:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('\nOK — no oversell, no orphan orders, arithmetic checks out.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
