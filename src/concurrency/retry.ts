import { DataSource, EntityManager } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

/**
 * The only two SQLSTATEs worth retrying:
 *
 *   40001 serialization_failure — the isolation level could not be honoured;
 *   40P01 deadlock_detected    — Postgres broke a lock cycle by killing us.
 *
 * Both share the property that makes a retry safe: the transaction was aborted
 * whole, left nothing behind, and the same statements can succeed on a fresh
 * snapshot. Nothing else qualifies. 23505 (unique violation), 23514 (check
 * violation), 23503 (FK violation) are deterministic — running them again just
 * fails again, more slowly, and retrying would hide a real bug instead of
 * fixing it. 57014 (statement cancelled) and 08006 (connection failure) are not
 * safe either: the first is someone deliberately stopping us, the second leaves
 * the outcome of the in-flight COMMIT unknown, so a blind retry could double it.
 */
export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['40001', '40P01']);

/** TypeORM wraps driver errors in QueryFailedError, so look in both places. */
export function sqlStateOf(error: unknown): string | undefined {
  const candidate = error as { code?: unknown; driverError?: { code?: unknown } } | null;
  const code = candidate?.code ?? candidate?.driverError?.code;
  return typeof code === 'string' ? code : undefined;
}

export function isRetryable(error: unknown): boolean {
  const code = sqlStateOf(error);
  return code !== undefined && RETRYABLE_SQLSTATES.has(code);
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Called once per caught serialization failure, before the backoff sleep. */
  onRetry?: (info: { attempt: number; sqlState: string; delayMs: number }) => void;
}

export interface RetryOutcome<T> {
  result: T;
  attempts: number;
  retries: { attempt: number; sqlState: string; delayMs: number }[];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` in a transaction, and on a retryable failure runs it again **from
 * the beginning** — reads included. That is the whole point: the reads are what
 * the aborted snapshot invalidated, so replaying only the write would reapply a
 * value computed from stale data, which is the lost update the isolation level
 * just saved us from.
 *
 * Backoff is exponential with full jitter, so a pack of writers that collided
 * once does not line up and collide again on the same schedule.
 */
export async function withRetry<T>(
  dataSource: DataSource,
  isolation: IsolationLevel,
  fn: (manager: EntityManager, attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const retries: RetryOutcome<T>['retries'] = [];

  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await dataSource.transaction(isolation, (manager) => fn(manager, attempt));
      return { result, attempts: attempt, retries };
    } catch (error) {
      const sqlState = sqlStateOf(error);

      if (!isRetryable(error) || attempt >= options.maxAttempts) {
        throw error;
      }

      const ceiling = Math.min(options.baseDelayMs * 2 ** (attempt - 1), options.maxDelayMs);
      const delayMs = Math.max(1, Math.round(Math.random() * ceiling));
      const info = { attempt, sqlState: sqlState as string, delayMs };

      retries.push(info);
      options.onRetry?.(info);

      await sleep(delayMs);
    }
  }
}
