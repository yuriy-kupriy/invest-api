import { DataSource, EntityManager } from 'typeorm';
import { withRetry } from './concurrency/retry';
import { dataSourceOptions } from './data-source';

/**
 * HW #14 p.4 — provoke a serialization failure, then survive it.
 *
 * WRITERS transactions do the same read-modify-write on one row under
 * REPEATABLE READ: read the balance, add DELTA in JavaScript, write the absolute
 * value back. That is the textbook lost-update shape — under READ COMMITTED the
 * writers would silently overwrite each other and the total would come out short.
 * Under REPEATABLE READ Postgres refuses instead: the first writer commits, and
 * every other writer whose snapshot predates that commit is aborted with
 * SQLSTATE 40001 (could not serialize access due to concurrent update).
 *
 * The barrier makes it deterministic rather than lucky: on the first attempt all
 * WRITERS read before any of them writes, so WRITERS - 1 failures are
 * guaranteed. Retries run unimpeded, take a fresh snapshot, and re-read — which
 * is exactly why the wrapper replays the whole transaction and not just the
 * UPDATE.
 */
const WRITERS = 5;
const DELTA_CENTS = 100;
const START_BALANCE_CENTS = 1_000_000;

// Seeded by src/seed.ts: id(2, 6) — user3's USD brokerage account. A different
// row from the one demo:race uses, so the two demos never interfere.
const ACCOUNT_ID = '00000002-0000-4000-8000-000000000006';

/** Releases everyone only once `count` participants have arrived. */
function barrier(count: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  return async () => {
    arrived += 1;
    if (arrived >= count) {
      release();
    }
    await opened;
  };
}

async function reset(dataSource: DataSource): Promise<void> {
  const [, affected]: [unknown[], number] = await dataSource.query(
    `UPDATE accounts SET balance_cents = $2 WHERE id = $1`,
    [ACCOUNT_ID, START_BALANCE_CENTS],
  );

  if (affected === 0) {
    throw new Error(`Account ${ACCOUNT_ID} is missing — run "npm run seed" first.`);
  }
}

async function main(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  try {
    await reset(dataSource);

    console.log(
      `Provoking serialization failures on purpose: the "could not serialize access due to\n` +
        `concurrent update" lines below are the scenario working, not the script breaking.\n`,
    );

    const allHaveRead = barrier(WRITERS);
    const log: string[] = [];

    const outcomes = await Promise.all(
      Array.from({ length: WRITERS }, (_unused, index) => {
        const writerId = `writer-${index + 1}`;

        return withRetry(
          dataSource,
          'REPEATABLE READ',
          async (manager: EntityManager, attempt: number) => {
            // Read. In REPEATABLE READ the snapshot is taken here, at the first
            // statement of the transaction — not at BEGIN.
            const rows: { balance_cents: string }[] = await manager.query(
              `SELECT balance_cents FROM accounts WHERE id = $1`,
              [ACCOUNT_ID],
            );
            const balance = Number(rows[0].balance_cents);

            // Modify in JS, so the write depends on the value read.
            const next = balance + DELTA_CENTS;

            if (attempt === 1) {
              await allHaveRead();
            }

            // Write the absolute value — no `balance_cents + $2` shortcut, which
            // would let the database resolve the conflict for us and there would
            // be nothing to retry.
            await manager.query(`UPDATE accounts SET balance_cents = $2 WHERE id = $1`, [
              ACCOUNT_ID,
              next,
            ]);

            return next;
          },
          {
            maxAttempts: 10,
            baseDelayMs: 20,
            maxDelayMs: 400,
            onRetry: ({ attempt, sqlState, delayMs }) => {
              log.push(
                `${writerId}: caught ${sqlState} on attempt ${attempt} — retrying whole transaction after ${delayMs} ms`,
              );
            },
          },
        );
      }),
    );

    const retries = outcomes.reduce((sum, outcome) => sum + outcome.retries.length, 0);
    const sqlStates = new Set(
      outcomes.flatMap((outcome) => outcome.retries.map((retry) => retry.sqlState)),
    );

    const [{ balance_cents: finalRaw }]: { balance_cents: string }[] = await dataSource.query(
      `SELECT balance_cents FROM accounts WHERE id = $1`,
      [ACCOUNT_ID],
    );
    const finalBalance = Number(finalRaw);
    const expected = START_BALANCE_CENTS + WRITERS * DELTA_CENTS;

    console.log(
      `Retry on serialization failure — ${WRITERS} concurrent read-modify-write under REPEATABLE READ\n`,
    );
    for (const line of log) {
      console.log(`  ${line}`);
    }

    console.log(`\nretries (повторів):               ${retries}`);
    console.log(`sqlstates caught:                 ${[...sqlStates].sort().join(', ') || '—'}`);
    console.log('attempts per writer:');
    for (const [index, outcome] of outcomes.entries()) {
      console.log(`  writer-${index + 1}: ${outcome.attempts}`);
    }
    console.log(`\nstart balance:                    ${START_BALANCE_CENTS} cents`);
    console.log(`final balance:                    ${finalBalance} cents`);
    console.log(
      `expected (${START_BALANCE_CENTS} + ${WRITERS} × ${DELTA_CENTS}):  ${expected} cents`,
    );

    const problems: string[] = [];
    if (retries === 0) {
      problems.push('no serialization failure was provoked — the scenario proves nothing');
    }
    if (finalBalance !== expected) {
      problems.push(`lost update: final balance ${finalBalance}, expected ${expected}`);
    }
    for (const sqlState of sqlStates) {
      if (sqlState !== '40001' && sqlState !== '40P01') {
        problems.push(`retried a non-retryable SQLSTATE ${sqlState}`);
      }
    }

    if (problems.length > 0) {
      console.error('\nFAILED:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('\nOK — every conflict was retried and the arithmetic adds up.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
