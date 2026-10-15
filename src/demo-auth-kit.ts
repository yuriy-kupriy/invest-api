import './register-aliases';
import { AddressInfo } from 'node:net';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { hashPassword } from './auth/password';
import { dataSourceOptions } from './data-source';

/**
 * Shared harness of demo:auth / demo:reuse / demo:rbac (HW #24). Each demo:
 *   1. migrates and resets exactly its own state (three demo users; deleting
 *      them cascades to their accounts, transactions and refresh tokens);
 *   2. boots the REAL app — createApp(), the same pipeline main.ts runs, with
 *      the OpenAPI validator and the global guards — on an ephemeral port, so
 *      there is no EADDRINUSE and no orphan server to `trap … EXIT`;
 *   3. prints `key=status` lines and exits non-zero if any differs from the
 *      expected status.
 */

export const PASSWORD = 'demo-password-24';

export const USERS = {
  owner: { id: '00000024-0000-4000-8000-000000000001', email: 'demo-owner@example.com', role: 'member' },
  other: { id: '00000024-0000-4000-8000-000000000002', email: 'demo-other@example.com', role: 'member' },
  viewer: { id: '00000024-0000-4000-8000-000000000003', email: 'demo-viewer@example.com', role: 'viewer' },
} as const;

export interface Reply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export interface Http {
  call(method: string, path: string, opts?: { token?: string; body?: unknown }): Promise<Reply>;
  login(user: { email: string }): Promise<Reply>;
  refresh(refreshToken: string): Promise<Reply>;
}

async function reset(ds: DataSource): Promise<void> {
  await ds.query(
    `INSERT INTO currency (code, numeric_code, exponent, name) VALUES ('UAH', 980, 2, 'Ukrainian hryvnia')
     ON CONFLICT DO NOTHING`,
  );
  const users = Object.values(USERS);
  const passwordHash = await hashPassword(PASSWORD);
  await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users.map((u) => u.id)]);
  for (const user of users) {
    await ds.query(
      `INSERT INTO users (id, email, display_name, password_hash, role) VALUES ($1, $2, $2, $3, $4)`,
      [user.id, user.email, passwordHash, user.role],
    );
  }
}

function http(base: string): Http {
  const call: Http['call'] = async (method, path, opts = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return {
    call,
    login: (user) => call('POST', '/auth/login', { body: { email: user.email, password: PASSWORD } }),
    refresh: (refreshToken) => call('POST', '/auth/refresh', { body: { refresh_token: refreshToken } }),
  };
}

export async function runDemo(
  expected: Record<string, number[]>,
  scenario: (http: Http) => Promise<Record<string, number>>,
): Promise<void> {
  // Offline and deterministic: no NBU fetch on boot. Set before create-app is
  // loaded, because the config is validated when AppModule is imported.
  process.env.FX_SYNC_ON_START = '0';

  const ds = await new DataSource(dataSourceOptions).initialize();
  let app: INestApplication | undefined;
  try {
    await ds.runMigrations();
    await reset(ds);

    const { createApp } = await import('./create-app');
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;

    const results = await scenario(http(`http://127.0.0.1:${port}`));

    const broken: string[] = [];
    for (const [key, allowed] of Object.entries(expected)) {
      console.log(`${key}=${results[key]}`);
      if (!allowed.includes(results[key])) {
        broken.push(`${key}: expected ${allowed.join(' or ')}, got ${results[key]}`);
      }
    }
    if (broken.length > 0) {
      console.error(`INVARIANT VIOLATED:\n  ${broken.join('\n  ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await app?.close();
    await ds.destroy();
  }
}
