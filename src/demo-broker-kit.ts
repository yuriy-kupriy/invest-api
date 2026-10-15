import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ConfirmChannel, connect } from 'amqplib';
import { DataSource } from 'typeorm';
import { OrderPlacedEvent } from './broker/order-placed.event';
import { publishEvent } from './broker/publisher';
import { assertTopology, brokerUrl, DLQ, RECEIPTS_QUEUE } from './broker/topology';
import { checkout } from './concurrency/checkout';
import { dataSourceOptions } from './data-source';

/**
 * Shared plumbing of the three HW #19 demos: a clean start, checkout with
 * publishing, the consumer as a child process, queue depths, and the
 * self-grading printout.
 */

// Seeded by src/seed.ts: user1's USD brokerage account and AAPL (same as demo:race).
const ACCOUNT_ID = '00000002-0000-4000-8000-000000000002';
const INSTRUMENT_ID = '00000003-0000-4000-8000-000000000001';
const MARKER = 'hw19 demo:broker';
const UNIT_PRICE_CENTS = 10_000;

export interface Consumer {
  /** Number of report lines starting with `word` ("delivered", "acked", …) and containing `contains`. */
  count(word: string, contains?: string): number;
  /** Resolves with the signal (or null) the process died of. */
  exited: Promise<NodeJS.Signals | null>;
}

export interface Demo {
  ds: DataSource;
  ch: ConfirmChannel;
  /** Starts the real consumer as a separate OS process; it is stopped when the demo ends. */
  spawnConsumer(env?: Record<string, string>): Consumer;
}

/**
 * Brings DB and broker to a known state — this demo's orders (and, by cascade,
 * their receipts) are gone, the account can afford them, both queues are
 * recreated empty — runs the demo, then stops its consumers and disconnects.
 * Acts as the topology bootstrap, so the publisher never declares anything.
 */
export function runDemo(main: (demo: Demo) => Promise<void>): void {
  const children: ChildProcess[] = [];
  const run = async () => {
    const ds = await new DataSource(dataSourceOptions).initialize();
    const conn = await connect(brokerUrl());
    try {
      const exists: unknown[] = await ds.query(`SELECT 1 FROM accounts WHERE id = $1`, [ACCOUNT_ID]);
      if (exists.length === 0) {
        throw new Error(`Account ${ACCOUNT_ID} is missing — run "npm run seed" first.`);
      }
      await ds.query(`DELETE FROM transactions WHERE description = $1`, [MARKER]);
      await ds.query(`UPDATE accounts SET balance_cents = $2 WHERE id = $1`, [ACCOUNT_ID, 100 * UNIT_PRICE_CENTS]);

      const ch = await conn.createConfirmChannel();
      await ch.deleteQueue(RECEIPTS_QUEUE);
      await ch.deleteQueue(DLQ);
      await assertTopology(ch);

      await main({ ds, ch, spawnConsumer: (env) => startConsumer(children, env) });
    } finally {
      children.forEach((child) => child.kill('SIGTERM'));
      await conn.close();
      await ds.destroy();
    }
  };
  run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

function startConsumer(children: ChildProcess[], env: Record<string, string> = {}): Consumer {
  const child = spawn(process.execPath, [join(__dirname, 'order-receipts-consumer.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  children.push(child);
  const lines: string[] = [];
  createInterface({ input: child.stdout! }).on('line', (line) => {
    console.log(line);
    lines.push(line);
  });
  return {
    count: (word, contains = '') =>
      lines.filter((l) => l.startsWith(`consumer ${word}`) && l.includes(contains)).length,
    exited: new Promise((resolve) => child.on('exit', (_code, signal) => resolve(signal))),
  };
}

/** One checkout of one unit; order.placed goes out through `publish` after COMMIT. */
export async function placeOrder(
  demo: Demo,
  publish: (event: OrderPlacedEvent) => Promise<void> = (event) => publishEvent(demo.ch, event),
): Promise<void> {
  const result = await checkout(
    demo.ds,
    { accountId: ACCOUNT_ID, instrumentId: INSTRUMENT_ID, quantity: 1, unitPriceCents: UNIT_PRICE_CENTS, description: MARKER },
    publish,
  );
  if (!result.ok) throw new Error(`checkout rejected: ${result.reason}`);
}

export async function queueDepths(ch: ConfirmChannel): Promise<{ work: number; dlq: number }> {
  const [work, dlq] = await Promise.all([ch.checkQueue(RECEIPTS_QUEUE), ch.checkQueue(DLQ)]);
  return { work: work.messageCount, dlq: dlq.messageCount };
}

/** Receipts written for this demo's orders — the effect, counted where it lives. */
export async function receiptCount(ds: DataSource): Promise<number> {
  const [{ count }]: { count: number }[] = await ds.query(
    `SELECT count(*)::int AS count FROM order_receipts r JOIN transactions t ON t.id = r.order_id
     WHERE t.description = $1`,
    [MARKER],
  );
  return count;
}

export async function waitFor(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Prints the summary as key=value lines (the grader's contract) and fails the
 * process if any invariant is broken. `checks` holds a message per broken
 * invariant and `false` for each one that holds.
 */
export function finish(summary: Record<string, number | string>, checks: (string | false)[]): void {
  const problems = checks.filter((c): c is string => c !== false);
  console.log('');
  for (const [key, value] of Object.entries(summary)) console.log(`${key}=${value}`);
  if (problems.length > 0) {
    console.error('\nFAILED:\n  - ' + problems.join('\n  - '));
    process.exitCode = 1;
    return;
  }
  console.log('\nOK');
}
