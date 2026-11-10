import {
  AbortMultipartUploadCommand,
  CreateBucketCommand,
  DeleteObjectsCommand,
  HeadBucketCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  Part,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageEnv, storageEnvSchema } from '../config/env.schema';

/**
 * HW #26 storage layer. No Nest here: the edge and demo:cdn use it without
 * booting the app. Relative imports only — scripts run it from dist/ directly.
 */

const MiB = 1024 * 1024;

/** S3 rules: every part but the last is >= 5 MiB, at most 10 000 parts. */
export const MIN_PART = 5 * MiB;
export const MAX_PARTS = 10_000;

/** Below two full parts there is nothing to resume: a single PUT is cheaper. */
export const MULTIPART_THRESHOLD = 2 * MIN_PART;

/** Largest file intent accepts; partSize below still keeps it under MAX_PARTS. */
export const MAX_FILE_SIZE = 50 * 1024 * MiB;

/** A form upload (avatar, product photo) starts seconds after intent. */
export const PUT_URL_TTL_S = 5 * 60;

/** One part URL covers one part; a resume call re-issues them, so they stay short. */
export const PART_URL_TTL_S = 15 * 60;

export interface PartPlan {
  partSize: number;
  partCount: number;
}

/** Part size is derived from the file: >= 5 MiB and >= size / 10 000, rounded up to 1 MiB. */
export function partPlan(size: number): PartPlan {
  const partSize = Math.ceil(Math.max(MIN_PART, size / MAX_PARTS) / MiB) * MiB;
  return { partSize, partCount: Math.ceil(size / partSize) };
}

/** HTTP status of an S3 SDK error; undefined when the error never reached S3. */
export function s3Status(err: unknown): number | undefined {
  return (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
}

export function storageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  return storageEnvSchema.parse(env);
}

export function s3Client(cfg: StorageEnv = storageEnv()): S3Client {
  return new S3Client({
    region: cfg.STORAGE_REGION,
    endpoint: cfg.STORAGE_ENDPOINT, // undefined => AWS S3
    forcePathStyle: Boolean(cfg.STORAGE_ENDPOINT), // emulators need path-style
    credentials: { accessKeyId: cfg.STORAGE_ACCESS_KEY, secretAccessKey: cfg.STORAGE_SECRET_KEY },
    // A presigned PUT is signed before the body exists: the default CRC32 would
    // be the checksum of empty data. Only compute checksums when S3 demands one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export async function ensureBucket(s3: S3Client, bucket: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    // Created private: no bucket policy, so anonymous requests get 403.
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

/**
 * ContentLength is signed, so storage refuses a body of any other size: the
 * client cannot announce 1 KB and push 5 GB through the same URL.
 */
export function presignPut(
  s3: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  size: number,
  ttlS = PUT_URL_TTL_S,
) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size }),
    { expiresIn: ttlS },
  );
}

export function presignParts(s3: S3Client, bucket: string, key: string, uploadId: string, partNumbers: number[]) {
  return Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await getSignedUrl(
        s3,
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn: PART_URL_TTL_S },
      ),
    })),
  );
}

/** Every part already stored for an upload (ListParts pages at 1 000). */
export async function listParts(s3: S3Client, bucket: string, key: string, uploadId: string): Promise<Part[]> {
  const parts: Part[] = [];
  let marker: string | undefined;
  do {
    const page = await s3.send(
      new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
    );
    parts.push(...(page.Parts ?? []));
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
}

/**
 * Brings a prefix back to empty: aborts unfinished multipart uploads (they are
 * invisible to ListObjects and still billed) and deletes the objects.
 */
export async function purgePrefix(s3: S3Client, bucket: string, prefix: string): Promise<void> {
  const uploads = await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket, Prefix: prefix }));
  for (const u of uploads.Uploads ?? []) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key, UploadId: u.UploadId }));
  }
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length > 0) await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    token = page.NextContinuationToken;
  } while (token);
}
