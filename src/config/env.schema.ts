import { z } from 'zod';

/** Runtime modes, exported so DTOs derive the enum instead of restating it. */
export const NODE_ENVS = ['development', 'test', 'production'] as const;

/**
 * `new URL()` that reports failure instead of throwing. Needed because `z.url()`
 * is a non-aborting check in zod 4: refines below still run on values that are
 * not URLs at all, and an unguarded parse would throw straight out of safeParse,
 * taking the aggregated error report with it.
 */
function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/**
 * The single source of truth for every environment variable the app reads.
 *
 * Two rules hold everywhere below:
 * - anything numeric goes through `z.coerce.number()`, because everything that
 *   arrives from the environment is a string;
 * - anything boolean-ish is an explicit `z.enum(['0', '1'])`, because
 *   `Boolean('0')` is `true` and `z.coerce.boolean()` would silently flip the flag on.
 *
 * Imported both by the Nest `validate` hook and by scripts/check-env-example.mjs
 * (from `dist/`), so this file must stay free of `@/` path aliases.
 */
export const envSchema = z.object({
  /** Runtime mode. Only affects logging verbosity and the /health payload. */
  NODE_ENV: z.enum(NODE_ENVS).default('development'),

  /** HTTP port the app listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /**
   * Postgres connection string WITHOUT a password — the password is a secret and
   * lives in a file (see DB_PASSWORD_FILE), never in an environment variable.
   */
  DB_URL: z
    .url({
      protocol: /^postgres(ql)?$/,
      error: 'must be a postgres:// or postgresql:// URL',
    })
    .refine(
      (value) => !parseUrl(value)?.password,
      'must not contain a password — the password belongs in DB_PASSWORD_FILE',
    ),

  /**
   * Path to the file holding the Postgres password, resolved against the process
   * working directory. Re-read on every new pool connection, which is what makes
   * rotation without a restart possible.
   */
  DB_PASSWORD_FILE: z.string().min(1).default('./secrets/db_password'),

  /** Maximum number of clients in the pg pool. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /** How long a single connection attempt may take, in milliseconds. */
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60000).default(5000),

  /**
   * Homework #9 leftover: `1` makes the transaction mapper emit `amountCents`
   * instead of `amount_cents`, so the response validator can be caught working.
   */
  DRIFT: z.enum(['0', '1']).default('0'),
});

export type Env = z.infer<typeof envSchema>;
