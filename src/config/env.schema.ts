import { createPrivateKey, createPublicKey, KeyObject } from 'node:crypto';
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
 * Signing keys travel as base64 of a PEM: a multi-line PEM does not survive
 * `export` in every shell, and the reward is DECODER routines::unsupported on
 * the first signature. Parsing here moves that failure to startup, and the
 * config hands out the decoded PEM bytes, so nobody decodes them again.
 */
function ecKey(parse: (pem: Buffer) => KeyObject) {
  return z
    .string()
    .min(1)
    .transform((value) => Buffer.from(value, 'base64'))
    .refine((pem) => {
      try {
        return parse(pem).asymmetricKeyType === 'ec';
      } catch {
        return false;
      }
    }, 'must be base64 of a PEM-encoded EC P-256 key (ES256)');
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
    .string()
    .min(1)
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

  /**
   * `1` fetches missing fx rates from NBU on startup (only the days after the
   * last stored one) before the in-memory rate cache is loaded.
   */
  FX_SYNC_ON_START: z.enum(['0', '1']).default('1'),

  /** Where the NBU history starts when `fx_rate` has no NBU rows for a currency yet. */
  FX_BACKFILL_FROM: z.iso.date().default('1999-01-01'),

  /** NBU API origin — overridable so a test or an outage drill can point elsewhere. */
  NBU_BASE_URL: z.string().url({ protocol: /^https?$/ }).default('https://bank.gov.ua'),

  /** Timeout of one NBU request, in milliseconds. The full history is ~2 MB. */
  NBU_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),

  // HW #24. Vault-only and deliberately WITHOUT defaults: a default signing key
  // is a key committed to git, and a bare `npm run start` must die naming the
  // missing variable instead.

  /** `kid` header of every access token; tells verifiers which public key to use. */
  JWT_KID: z.string().min(1),

  /** base64 of the PKCS#8 PEM private key that signs access tokens (ES256). */
  JWT_PRIVATE_KEY: ecKey((pem) => createPrivateKey(pem)),

  /** base64 of the SPKI PEM public key that verifies access tokens. */
  JWT_PUBLIC_KEY: ecKey((pem) => createPublicKey(pem)),

  /** HMAC key for refresh-token hashes, so a table dump is not a dump of live sessions. */
  REFRESH_TOKEN_PEPPER: z.string().min(8),
});

export type Env = z.infer<typeof envSchema>;
