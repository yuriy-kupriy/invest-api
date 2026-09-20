import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type JobStatus = 'pending' | 'done';

/**
 * The post-processing queue (HW #14). A checkout writes the receipt job in the
 * same transaction as the order, so a committed order always has its job and a
 * rolled-back one never leaves a task behind.
 *
 * Workers claim rows with FOR UPDATE SKIP LOCKED and hold the transaction open
 * for the whole handler, so a worker that dies before COMMIT drops its lock and
 * another one picks the job up. `processed` counts how many times a handler
 * actually ran for this row — it is the check that a job was handled exactly
 * once (a value > 1 means two workers got the same row, i.e. SKIP LOCKED was
 * not doing its job), and `workerId` records which worker claimed it.
 */
@Entity({ name: 'job_queue' })
@Check('job_queue_status_enum', "status IN ('pending', 'done')")
@Check('job_queue_processed_non_negative', 'processed >= 0')
@Check('job_queue_type_length', 'length(type) BETWEEN 1 AND 60')
// Partial index for the claim query (pending rows only, oldest first). The
// WHERE clause has no decorator syntax, so the real DDL is in the migration by
// hand — same pattern as transactions_pending_booked_idx.
@Index('job_queue_pending_created_idx', { synchronize: false })
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  type!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ type: 'text', default: 'pending' })
  status!: JobStatus;

  @Column({ type: 'integer', default: 0 })
  processed!: number;

  @Column({ name: 'worker_id', type: 'text', nullable: true })
  workerId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz', precision: 3 })
  createdAt!: Date;
}
