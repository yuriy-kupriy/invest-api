import { envSchema, Env } from './env.schema';

/**
 * The `validate` hook of ConfigModule.forRoot. It runs BEFORE the DI graph is
 * built, so there is no second chance to report anything: one safeParse, and the
 * thrown error lists every broken variable at once instead of failing on the
 * first one and hiding the rest.
 *
 * The return value replaces the raw strings inside ConfigService, which is why
 * `PORT` is a real number by the time the code reads it.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (result.success) {
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });

  throw new Error(
    `Invalid environment configuration (${lines.length} ${lines.length === 1 ? 'variable' : 'variables'}):\n` +
      `${lines.join('\n')}\n` +
      `Compare your .env against .env.example — that file is the contract.`,
  );
}
