import { DataSource } from 'typeorm';
import { Job } from '../entities/job.entity';

export interface WorkerOptions {
  /** How long the simulated handler takes, per job. */
  handlerMs: number;
  /** Consecutive empty claims before the worker decides the queue is drained. */
  maxIdlePolls: number;
  /** Pause between empty claims. */
  idleDelayMs: number;
}

export interface WorkerStats {
  workerId: string;
  jobIds: string[];
  idlePolls: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One worker of the pool. Every iteration is its own transaction:
 *
 *   SELECT … WHERE status = 'pending' … FOR UPDATE SKIP LOCKED LIMIT 1
 *   <handler runs — the transaction stays open, the row stays locked>
 *   UPDATE … SET status = 'done', processed = processed + 1, worker_id = …
 *   COMMIT
 *
 * SKIP LOCKED is what makes the pool work: a row another worker is already
 * holding is invisible to this one, so N workers pull N different jobs instead
 * of queueing behind the same lock. Holding the transaction open across the
 * handler is deliberate — a worker that dies mid-handler never reaches COMMIT,
 * its lock disappears with its connection, and the job goes back to being
 * claimable. The result and the 'done' status commit together, so there is no
 * state where a job is marked processed but its work was lost.
 */
export async function runWorker(
  dataSource: DataSource,
  workerId: string,
  options: WorkerOptions,
): Promise<WorkerStats> {
  const jobIds: string[] = [];
  let idlePolls = 0;
  let consecutiveIdle = 0;

  for (;;) {
    const claimedId = await dataSource.transaction(async (manager): Promise<string | null> => {
      const job = await manager
        .createQueryBuilder(Job, 'j')
        .setLock('pessimistic_write') // FOR UPDATE
        .setOnLocked('skip_locked') // … SKIP LOCKED
        .where('j.status = :status', { status: 'pending' })
        .orderBy('j.createdAt', 'ASC')
        .addOrderBy('j.id', 'ASC')
        .limit(1)
        .getOne();

      if (!job) {
        return null;
      }

      // The "work": a receipt/e-mail would happen here. Runs inside the
      // transaction, with the row still locked.
      await sleep(options.handlerMs);

      await manager.query(
        `UPDATE job_queue
         SET status = 'done', processed = processed + 1, worker_id = $2
         WHERE id = $1`,
        [job.id, workerId],
      );

      return job.id;
    });

    if (claimedId) {
      jobIds.push(claimedId);
      consecutiveIdle = 0;
      continue;
    }

    // An empty result means "nothing free right now", not "queue is empty":
    // every pending row could be locked by a sibling worker at this instant. So
    // ask again a few times before calling it a day.
    idlePolls += 1;
    consecutiveIdle += 1;

    if (consecutiveIdle >= options.maxIdlePolls) {
      return { workerId, jobIds, idlePolls };
    }

    await sleep(options.idleDelayMs);
  }
}
