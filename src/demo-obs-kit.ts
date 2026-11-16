import './register-aliases';
import { ChildProcess, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { DataSource } from 'typeorm';
import { reset, PASSWORD, USERS } from './demo-auth-kit';
import { dataSourceOptions } from './data-source';
import { finish, waitFor } from './demo-kit';

/**
 * Harness of HW #29 demo:logs / demo:metrics / demo:trace. Each run:
 *   1. migrates and resets its own state (demo users of HW #24, cascading to
 *      their accounts and transactions);
 *   2. starts the REAL service — `node dist/main.js`, OTel bootstrapped on its
 *      first line exactly as in production — and keeps every stdout line;
 *   3. logs in and opens a fresh UAH account to book against;
 *   4. prints key=number and exits non-zero if an invariant is broken.
 * Port 22910 is the one Prometheus scrapes; the run lingers until one more
 * scrape lands, so demo traffic shows on the dashboard.
 */

export const APP_PORT = 22910;
const BASE = `http://127.0.0.1:${APP_PORT}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LogLine = Record<string, any>;

export interface Reply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  text: string;
}

export interface Obs {
  base: string;
  token: string;
  accountId: string;
  userId: string;
  /** Every stdout line of the service, raw. */
  stdout: string[];
  /** stdout lines that parsed as JSON objects. */
  logs(): LogLine[];
  call(method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown; token?: string }): Promise<Reply>;
  /** Waits until the service logged `request completed` for this trace id. */
  completed(traceId: string): Promise<LogLine>;
}

/** W3C Trace Context: 00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>. */
export function traceparent(): { header: string; traceId: string; parentId: string } {
  const traceId = randomBytes(16).toString('hex');
  const parentId = randomBytes(8).toString('hex');
  return { header: `00-${traceId}-${parentId}-01`, traceId, parentId };
}

/** One identical checkout body — the burst sends it N times with N keys. */
export function checkoutBody(accountId: string): unknown {
  return {
    entries: [
      { account_id: accountId, type: 'expense', amount_cents: 4599, currency: 'UAH', booked_at: '2026-08-25T10:00:00.000Z' },
    ],
  };
}

export function newIdempotencyKey(): string {
  return randomUUID();
}

function startService(): { child: ChildProcess; stdout: string[] } {
  const child = spawn(process.execPath, [join(__dirname, 'main.js')], {
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      FX_SYNC_ON_START: '0',
      FAULT_INJECTION: '1',
      LOG_LEVEL: 'info',
      // Export spans every 100 ms instead of 5 s; demo:trace still polls with a timeout.
      OTEL_BSP_SCHEDULE_DELAY: '100',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stdout: string[] = [];
  createInterface({ input: child.stdout! }).on('line', (line) => stdout.push(line));
  return { child, stdout };
}

function parse(line: string): LogLine | undefined {
  try {
    const value = JSON.parse(line);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function call(
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown; token?: string } = {},
): Promise<Reply> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: res.status, body, text };
}

/**
 * Keeps the service up until Prometheus (PROMETHEUS_URL) has scraped it once
 * more, so the dashboard shows the demo's final counters. Skipped without the URL.
 */
async function waitForScrape(): Promise<void> {
  const prometheus = process.env.PROMETHEUS_URL;
  if (!prometheus) return;
  const since = Date.now() / 1000;
  const query = encodeURIComponent('timestamp(up{job="invest-api"})');
  await waitFor(
    `a Prometheus scrape of :${APP_PORT}`,
    async () => {
      const res = await fetch(`${prometheus}/api/v1/query?query=${query}`).catch(() => undefined);
      const body = res?.ok ? ((await res.json()) as { data?: { result?: { value: [number, string] }[] } }) : undefined;
      return Number(body?.data?.result?.[0]?.value[1] ?? 0) > since;
    },
    15_000,
  ).catch((err: Error) => console.error(`warning: ${err.message} — the dashboard may miss this run`));
}

export async function runObsDemo(
  scenario: (obs: Obs) => Promise<{ summary: Record<string, number>; checks: (string | false)[] }>,
): Promise<void> {
  const ds = await new DataSource(dataSourceOptions).initialize();
  try {
    await ds.runMigrations();
    await reset(ds);
  } finally {
    await ds.destroy();
  }

  const { child, stdout } = startService();
  let exited = false;
  child.once('exit', () => (exited = true));
  try {
    await waitFor(
      `the service on :${APP_PORT}`,
      async () => {
        if (exited) throw new Error(`the service exited during startup — is port ${APP_PORT} free?`);
        return (await call('GET', '/health').catch(() => undefined))?.status === 200;
      },
      30_000,
    );

    const login = await call('POST', '/auth/login', { body: { email: USERS.owner.email, password: PASSWORD } });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text}`);
    const token: string = login.body.access_token;
    const account = await call('POST', '/accounts', {
      token,
      body: { name: 'HW29 demo', type: 'cash', currency: 'UAH', opening_balance_cents: 1_000_000 },
    });
    if (account.status !== 201) throw new Error(`account create failed: ${account.status} ${account.text}`);

    const logs = () => stdout.map(parse).filter((l): l is LogLine => l !== undefined);
    const obs: Obs = {
      base: BASE,
      token,
      accountId: account.body.id,
      userId: USERS.owner.id,
      stdout,
      logs,
      call: (method, path, opts = {}) => call(method, path, { token, ...opts }),
      completed: async (traceId) => {
        let found: LogLine | undefined;
        await waitFor(`request completed for trace ${traceId}`, () => {
          found = logs().find((l) => l.trace_id === traceId && l.msg === 'request completed');
          return found !== undefined;
        });
        return found!;
      },
    };

    const { summary, checks } = await scenario(obs);
    await waitForScrape();
    finish(summary, checks);
  } finally {
    if (!exited) {
      child.kill('SIGTERM');
      await waitFor('the service to exit', () => exited, 10_000).catch(() => child.kill('SIGKILL'));
    }
  }
}
