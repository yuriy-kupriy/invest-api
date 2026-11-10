import { JobsOptions, Processor, Queue, Worker } from 'bullmq';
import { queueUrl } from './connections';

/** Follow-up of HW #22's order.placed: the receipt e-mail is sent off the HTTP path. */
const RECEIPT_EMAIL_QUEUE = 'receipt-email';

const JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 200, jitter: 0.5 },
  // Not `true`: a removed job no longer counts as a duplicate, which would switch jobId dedup off.
  removeOnComplete: { age: 3600 },
  removeOnFail: { age: 24 * 3600 },
};

/** `prefix` namespaces the queue's keys — the demo uses its own so it never touches real jobs. */
// A producer should fail fast when Redis is gone — default maxRetriesPerRequest.
export const receiptEmailQueue = (prefix = 'bull') =>
  new Queue(RECEIPT_EMAIL_QUEUE, { connection: { url: queueUrl() }, prefix, defaultJobOptions: JOB_OPTIONS });

// A worker must wait for Redis instead of crashing: maxRetriesPerRequest null (BullMQ requirement).
export const receiptEmailWorker = (processor: Processor, prefix = 'bull') =>
  new Worker(RECEIPT_EMAIL_QUEUE, processor, { connection: { url: queueUrl(), maxRetriesPerRequest: null }, prefix });
