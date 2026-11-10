import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { AuthUser } from '@/auth/auth.types';
import { assertOwner } from '@/auth/ownership';
import { problem } from '@/shared/problem.exception';
import {
  listParts,
  MAX_FILE_SIZE,
  MULTIPART_THRESHOLD,
  partPlan,
  presignParts,
  presignPut,
  PUT_URL_TTL_S,
  PART_URL_TTL_S,
  s3Client,
  s3Status,
  storageEnv,
} from './storage';

/** The only types we accept; the extension comes from here, never from the filename. */
export const CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/gzip': 'gz', // pg dumps (HW #15)
};

export interface IntentRequest {
  filename: string;
  contentType: string;
  size: number;
}

interface FileRow {
  id: string;
  key: string;
  owner_id: string;
  status: 'PENDING' | 'COMPLETED';
  size: string;
  upload_id: string | null;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    const cfg = storageEnv();
    this.s3 = s3Client(cfg);
    this.bucket = cfg.STORAGE_BUCKET;
  }

  async intent(body: IntentRequest, user: AuthUser) {
    const ext = CONTENT_TYPES[body.contentType];
    if (!ext) {
      throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'content-type-not-allowed', `${body.contentType} is not accepted`);
    }
    if (!Number.isInteger(body.size) || body.size < 1 || body.size > MAX_FILE_SIZE) {
      throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'size-out-of-range', `size must be 1..${MAX_FILE_SIZE}`);
    }
    // body.filename is display-only and deliberately unused: a client-chosen
    // path segment would let it write anywhere in the bucket.
    const id = randomUUID();
    const key = `uploads/${user.id}/${randomUUID()}.${ext}`;

    if (body.size <= MULTIPART_THRESHOLD) {
      await this.insert(id, key, user.id, body, null);
      const uploadUrl = await presignPut(this.s3, this.bucket, key, body.contentType, body.size);
      this.logger.log(`intent file_id=${id} key=${key} single`);
      return { fileId: id, key, uploadUrl, expiresIn: PUT_URL_TTL_S };
    }

    const { partSize, partCount } = partPlan(body.size);
    const created = await this.s3.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: body.contentType }),
    );
    await this.insert(id, key, user.id, body, created.UploadId!);
    const parts = await presignParts(
      this.s3,
      this.bucket,
      key,
      created.UploadId!,
      Array.from({ length: partCount }, (_, i) => i + 1),
    );
    this.logger.log(`intent file_id=${id} key=${key} multipart parts=${partCount}`);
    return { fileId: id, key, partSize, partCount, parts, expiresIn: PART_URL_TTL_S };
  }

  /** Resume: ask storage what it already has (ListParts) and sign only the rest. */
  async parts(fileId: string, user: AuthUser) {
    const row = await this.load(fileId, user);
    if (!row.upload_id || row.status !== 'PENDING') {
      throw problem(HttpStatus.CONFLICT, 'not-multipart', `file ${fileId} has no open multipart upload`);
    }
    const { partSize, partCount } = partPlan(Number(row.size));
    const stored = await listParts(this.s3, this.bucket, row.key, row.upload_id);
    const uploaded = stored.map((p) => p.PartNumber!).sort((a, b) => a - b);
    const missing = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !uploaded.includes(n));
    const parts = await presignParts(this.s3, this.bucket, row.key, row.upload_id, missing);
    return { fileId, partSize, partCount, uploaded, parts, expiresIn: PART_URL_TTL_S };
  }

  /** The object must really be there (HeadObject) and be the announced size. */
  async commit(fileId: string, user: AuthUser) {
    const row = await this.load(fileId, user);
    if (row.status === 'COMPLETED') {
      return this.view(row);
    }

    if (row.upload_id) {
      try {
        await this.complete(row.key, row.upload_id, Number(row.size));
      } catch (err) {
        const name = (err as Error).name;
        if (name === 'EntityTooSmall' || name === 'InvalidPart' || name === 'InvalidPartOrder') {
          throw problem(HttpStatus.CONFLICT, 'parts-invalid', `parts of file ${fileId} are not valid: ${name}`);
        }
        // NoSuchUpload: an earlier commit already completed it and stopped before
        // the UPDATE (crash, size mismatch, double tap) — HeadObject decides now.
        if (name !== 'NoSuchUpload') throw err;
      }
    }

    let size: number | undefined;
    try {
      const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: row.key }));
      size = head.ContentLength;
    } catch (err) {
      if (s3Status(err) !== 404) throw err;
      throw problem(HttpStatus.CONFLICT, 'object-missing', `nothing was uploaded for file ${fileId}`);
    }
    if (size !== Number(row.size)) {
      throw problem(HttpStatus.CONFLICT, 'size-mismatch', `expected ${row.size} bytes, storage has ${size}`);
    }

    const [updated]: FileRow[][] = await this.dataSource.query(
      `UPDATE files SET status = 'COMPLETED', upload_id = NULL, completed_at = now() WHERE id = $1 RETURNING *`,
      [fileId],
    );
    this.logger.log(`commit file_id=${fileId} key=${row.key} size=${size}`);
    return this.view(updated[0]);
  }

  private async complete(key: string, uploadId: string, size: number) {
    const { partCount } = partPlan(size);
    const stored = await listParts(this.s3, this.bucket, key, uploadId);
    if (stored.length !== partCount) {
      throw problem(HttpStatus.CONFLICT, 'parts-missing', `${stored.length} of ${partCount} parts uploaded`);
    }
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: stored.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })) },
      }),
    );
  }

  private async insert(id: string, key: string, ownerId: string, body: IntentRequest, uploadId: string | null) {
    await this.dataSource.query(
      `INSERT INTO files (id, key, owner_id, content_type, size, upload_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, key, ownerId, body.contentType, body.size, uploadId],
    );
  }

  private async load(fileId: string, user: AuthUser): Promise<FileRow> {
    const rows: FileRow[] = await this.dataSource.query(`SELECT * FROM files WHERE id = $1`, [fileId]);
    if (!rows[0]) {
      throw problem(HttpStatus.NOT_FOUND, 'file-not-found', `file ${fileId} was not found`);
    }
    assertOwner(rows[0].owner_id, user, `file ${fileId}`);
    return rows[0];
  }

  private view(row: FileRow) {
    return { fileId: row.id, key: row.key, status: row.status, size: Number(row.size) };
  }
}
