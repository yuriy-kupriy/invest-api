import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HW #26: the list of files lives here, not in a bucket listing (listing is
 * paid and pages 1 000 keys at a time). A row is born PENDING on intent and
 * becomes COMPLETED only after commit has seen the object with HeadObject.
 * upload_id is set for multipart uploads until they are completed.
 */
export class Files1790300000000 implements MigrationInterface {
  name = 'Files1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "files" (` +
        `"id" uuid NOT NULL, ` +
        `"key" text NOT NULL, ` +
        `"owner_id" uuid NOT NULL, ` +
        `"status" text NOT NULL DEFAULT 'PENDING', ` +
        `"content_type" text NOT NULL, ` +
        `"size" bigint NOT NULL, ` +
        `"upload_id" text, ` +
        `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `"completed_at" TIMESTAMP(3) WITH TIME ZONE, ` +
        `CONSTRAINT "files_pkey" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "files_key_unique" UNIQUE ("key"), ` +
        `CONSTRAINT "files_status_enum" CHECK (status IN ('PENDING', 'COMPLETED')), ` +
        `CONSTRAINT "files_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    // The orphan sweeper's query: PENDING rows older than a day.
    await queryRunner.query(`CREATE INDEX "files_pending_idx" ON "files" ("created_at") WHERE status = 'PENDING'`);
    await queryRunner.query(`CREATE INDEX "files_owner_idx" ON "files" ("owner_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "files"`);
  }
}
