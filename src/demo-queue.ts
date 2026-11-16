import { setTimeout as sleep } from 'node:timers/promises';
import { Job } from 'bullmq';
import { finish, run, waitFor } from './demo-kit';
import { configGet, queueRedis } from './redis/connections';
import { receiptEmailQueue, receiptEmailWorker } from './redis/queue';

/**
 * HW #23 demo:queue — on the receipt-email queue (own key prefix, so real jobs
 * are never touched): a job that fails twice and succeeds on the retry, two
 * adds with one jobId that leave one job, and a job scheduler upserted twice
 * that stays one scheduler and fires repeatedly.
 */
const PREFIX = 'demo-hw23';
const FAIL_TIMES = 2;
const SCHEDULER_ID = 'demo-tick';
const OBSERVE_MS = 3_000;

async function main() {
  const probe = queueRedis();
  const queue = receiptEmailQueue(PREFIX);
  await queue.obliterate({ force: true });

  let flakyRuns = 0;
  let ticks = 0;
  const worker = receiptEmailWorker(async (job: Job) => {
    if (job.name === 'flaky') {
      flakyRuns++;
      if (flakyRuns <= job.data.failTimes) throw new Error(`SMTP 503 (run ${flakyRuns})`);
    }
    if (job.name === 'tick') ticks++;
  }, PREFIX);

  try {
    const queueNoeviction = (await configGet(probe, 'maxmemory-policy')) === 'noeviction' ? 1 : 0;

    // 1. Retries with exponential backoff + jitter.
    const flaky = await queue.add('flaky', { failTimes: FAIL_TIMES });
    let state = '';
    await waitFor('the flaky job to finish', async () => ['completed', 'failed'].includes((state = await flaky.getState())));
    const completed = state === 'completed' ? 1 : 0;
    console.log(`flaky job: ${flakyRuns} runs, final state ${state}`);

    // 2. Dedup by jobId. Delayed, so the first job is still in the queue when the second add arrives.
    const jobId = 'receipt-order-demo-hw23';
    const ids = [];
    for (let i = 0; i < 2; i++) ids.push((await queue.add('receipt', { orderId: 'order-demo-hw23' }, { jobId, delay: 60_000 })).id);
    const counts = await queue.getJobCounts('wait', 'delayed', 'prioritized');
    const queued = Object.values(counts).reduce((a, b) => a + b, 0);

    // 3. Job scheduler: upsert twice (a restart), still one scheduler.
    for (let i = 0; i < 2; i++) {
      await queue.upsertJobScheduler(SCHEDULER_ID, { every: 500 }, { name: 'tick', data: {} });
    }
    const schedulers = (await queue.getJobSchedulers()).length;
    await sleep(OBSERVE_MS);
    await queue.removeJobScheduler(SCHEDULER_ID);

    finish(
      {
        'queue-noeviction': queueNoeviction,
        attempts: flakyRuns,
        completed,
        added: ids.length,
        queued,
        schedulers,
        'scheduled-runs': ticks,
      },
      [
        queueNoeviction !== 1 && 'queue instance is not maxmemory-policy noeviction',
        flakyRuns !== FAIL_TIMES + 1 && `flaky job ran ${flakyRuns} times, expected ${FAIL_TIMES + 1}`,
        completed !== 1 && 'flaky job did not complete',
        ids[0] !== ids[1] && `the two adds got different ids ${ids.join(' / ')}`,
        queued !== 1 && `${queued} jobs queued after two adds with one jobId`,
        schedulers !== 1 && `${schedulers} schedulers after two upserts`,
        ticks < 2 && `scheduler fired ${ticks} times in ${OBSERVE_MS} ms`,
      ],
    );
  } finally {
    await worker.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await probe.quit();
  }
}

run(main);
