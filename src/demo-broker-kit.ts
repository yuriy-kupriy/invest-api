import { ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { ChannelModel, ConfirmChannel, connect } from 'amqplib';
import { DataSource } from 'typeorm';
import { assertTopology, brokerUrl, DLQ, RECEIPTS_QUEUE } from './broker/topology';
import { dataSourceOptions } from './data-source';

/**
 * Shared plumbing of the three HW #19 demos: a clean start, the consumer as a
 * child process, queue depths, and the self-grading printout.
 */

// Seeded by src/seed.ts: user1's USD brokerage account and AAPL (same as demo:race).
export const ACCOUNT_ID = '00000002-0000-4000-8000-000000000002';
export const INSTRUMENT_ID = '00000003-0000-4000-8000-000000000001';
export const MARKER = 'hw19 demo:broker';
export const UNIT_PRICE_CENTS = 10_000;

export interface Demo {
  ds: DataSource;
  conn: ChannelModel;
  ch: ConfirmChannel;
}

/**
 * Brings DB and broker to a known state: this demo's orders (and, by cascade,
 * their receipts) are gone, the account can afford them, both queues are
 * recreated empty. Acts as the topology bootstrap, so the publisher never
 * declares anything.
 */
export async function openDemo(): Promise<Demo> {
  const ds = await new DataSource(dataSourceOptions).initialize();
  const exists: unknown[] = await ds.query(`SELECT 1 FROM accounts WHERE id = $1`, [ACCOUNT_ID]);
  if (exists.length === 0) {
    throw new Error(`Account ${ACCOUNT_ID} is missing — run "npm run seed" first.`);
  }
  await ds.query(`DELETE FROM transactions WHERE description = $1`, [MARKER]);
  await ds.query(`UPDATE accounts SET balance_cents = $2 WHERE id = $1`, [ACCOUNT_ID, 100 * UNIT_PRICE_CENTS]);

  const conn = await connect(brokerUrl());
  const ch = await conn.createConfirmChannel();
  await ch.deleteQueue(RECEIPTS_QUEUE);
  await ch.deleteQueue(DLQ);
  await assertTopology(ch);
  return { ds, conn, ch };
}

export async function closeDemo(demo: Demo): Promise<void> {
  await demo.conn.close();
  await demo.ds.destroy();
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

export interface Consumer {
  /** Number of report lines starting with `word` ("delivered", "acked", …). */
  count(word: string, contains?: string): number;
  /** Resolves with the signal (or null) the process died of. */
  exited: Promise<NodeJS.Signals | null>;
  stop(): void;
}

/** The real consumer, as a separate OS process; its report lines are echoed and counted. */
export function spawnConsumer(env: Record<string, string> = {}): Consumer {
  const child: ChildProcess = spawn(process.execPath, [join(__dirname, 'order-receipts-consumer.js')], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const lines: string[] = [];
  createInterface({ input: child.stdout! }).on('line', (line) => {
    console.log(line);
    lines.push(line);
  });
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)));
  return {
    count: (word, contains = '') =>
      lines.filter((l) => l.startsWith(`consumer ${word}`) && l.includes(contains)).length,
    exited,
    stop: () => void child.kill('SIGTERM'),
  };
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

export function runDemo(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
