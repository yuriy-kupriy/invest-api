import { DataSource } from 'typeorm';
import { runWorker, WorkerStats } from './concurrency/worker';
import { dataSourceOptions } from './data-source';

/**
 * HW #14 p.3 — the worker pool. WORKERS workers (Promises in one process, each
 * on its own pool connection) drain JOBS jobs from job_queue with
 * FOR UPDATE SKIP LOCKED, and the script proves two things: every job ran
 * exactly once, and the pool really was parallel (wall time well under
 * JOBS × HANDLER_MS).
 */
const JOBS = 24;
const WORKERS = 4;
const HANDLER_MS = 60;
const JOB_TYPE = 'demo_receipt';

async function reset(dataSource: DataSource): Promise<void> {
  // The queue is this demo's own fixture: clear it, then fill it with a known
  // number of jobs so the numbers below describe this run only.
  await dataSource.query(`DELETE FROM job_queue`);
  await dataSource.query(
    `INSERT INTO job_queue (type, payload)
     SELECT $1, jsonb_build_object('n', n) FROM generate_series(1, $2) AS n`,
    [JOB_TYPE, JOBS],
  );
}

async function main(): Promise<void> {
  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();

  try {
    await reset(dataSource);

    const startedAt = Date.now();

    const stats: WorkerStats[] = await Promise.all(
      Array.from({ length: WORKERS }, (_unused, index) =>
        runWorker(dataSource, `worker-${index + 1}`, {
          handlerMs: HANDLER_MS,
          maxIdlePolls: 3,
          idleDelayMs: 25,
        }),
      ),
    );

    const elapsedMs = Date.now() - startedAt;
    const sequentialMs = JOBS * HANDLER_MS;

    const [{ count: twiceRaw }]: { count: string }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM job_queue WHERE processed > 1`,
    );
    const processedTwice = Number(twiceRaw);

    const [{ count: unfinishedRaw }]: { count: string }[] = await dataSource.query(
      `SELECT count(*)::int AS count FROM job_queue WHERE status <> 'done' OR processed <> 1`,
    );
    const unfinished = Number(unfinishedRaw);

    // Distribution straight from the table, not from process memory — worker_id
    // is committed together with the result.
    const perWorker: { worker_id: string; count: number }[] = await dataSource.query(
      `SELECT worker_id, count(*)::int AS count FROM job_queue
       GROUP BY worker_id ORDER BY worker_id`,
    );

    console.log(
      `Worker pool — ${WORKERS} workers, ${JOBS} jobs, FOR UPDATE SKIP LOCKED, ${HANDLER_MS} ms per job\n`,
    );
    console.log('worker      claimed   idle polls');
    console.log('---------   -------   ----------');
    for (const stat of stats) {
      console.log(
        `${stat.workerId.padEnd(11)} ${String(stat.jobIds.length).padStart(7)}   ${String(stat.idlePolls).padStart(10)}`,
      );
    }

    console.log('\nsame distribution as committed in job_queue.worker_id:');
    for (const row of perWorker) {
      console.log(`  ${(row.worker_id ?? '<null>').padEnd(11)} ${String(row.count).padStart(3)}`);
    }

    console.log(`\nprocessed twice (оброблено двічі): ${processedTwice}`);
    console.log(`jobs not finished exactly once:   ${unfinished}`);
    console.log(`total time:                       ${elapsedMs} ms`);
    console.log(`sequential baseline (${JOBS} × ${HANDLER_MS} ms):  ${sequentialMs} ms`);
    console.log(`speedup:                          ${(sequentialMs / elapsedMs).toFixed(2)}×`);

    const claimedIds = stats.flatMap((stat) => stat.jobIds);
    const distinctClaimed = new Set(claimedIds).size;
    const activeWorkers = stats.filter((stat) => stat.jobIds.length > 0).length;

    const problems: string[] = [];
    if (processedTwice !== 0) {
      problems.push(`${processedTwice} job(s) processed more than once — SKIP LOCKED did not hold`);
    }
    if (unfinished !== 0) {
      problems.push(`${unfinished} job(s) are not 'done' with processed = 1`);
    }
    if (claimedIds.length !== JOBS || distinctClaimed !== JOBS) {
      problems.push(
        `workers claimed ${claimedIds.length} jobs (${distinctClaimed} distinct), expected ${JOBS} distinct`,
      );
    }
    if (activeWorkers < 2) {
      problems.push(`only ${activeWorkers} worker(s) claimed anything — the pool was not shared`);
    }
    if (elapsedMs >= sequentialMs) {
      problems.push(`${elapsedMs} ms is not faster than the ${sequentialMs} ms sequential baseline`);
    }

    if (problems.length > 0) {
      console.error('\nFAILED:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exitCode = 1;
      return;
    }

    console.log('\nOK — every job handled exactly once, by more than one worker, faster than serial.');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
