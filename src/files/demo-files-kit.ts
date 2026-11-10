import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { s3Status } from './storage';

/** Helpers shared by demo:upload and demo:multipart. */

export function tempFile(name: string, body: Buffer): string {
  const path = join(mkdtempSync(join(tmpdir(), 'hw26-')), name);
  writeFileSync(path, body);
  return path;
}

/**
 * Runs upload-client.ts as a separate process with nothing but PATH in its
 * environment: no storage keys, no DB, no vault values. Async on purpose: the
 * child may call the API, which lives in this process's event loop.
 */
export function client(input: object): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(__dirname, 'upload-client.js')], {
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(JSON.stringify(input));
  });
}

export function grab(stdout: string, key: string): number {
  const m = new RegExp(`^${key}=(\\d+)`, 'm').exec(stdout);
  return m ? Number(m[1]) : 0;
}

/** HeadObject as an HTTP status: 200 with the head, or the error's status (404). */
export async function head(s3: S3Client, bucket: string, key: string) {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { status: 200, size: res.ContentLength, etag: res.ETag };
  } catch (err) {
    const status = s3Status(err);
    if (!status) throw err;
    return { status };
  }
}
