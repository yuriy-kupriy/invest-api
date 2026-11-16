import { AddressInfo } from 'node:net';
import type { Express } from 'express';

/**
 * Dependency-free helpers shared by the demos. Kept apart from demo-broker-kit
 * so a Redis-only demo does not load data-source.ts (which needs DB env at import).
 */

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

export async function waitFor(what: string, check: () => boolean | Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Runs a demo's main; any throw prints and exits 1. */
export function run(main: () => Promise<void>): void {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

/** Starts an express app on an ephemeral port — one "pod" of a demo. */
export async function listen(app: Express, path: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = await new Promise<ReturnType<Express['listen']>>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
