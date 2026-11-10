import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Publishes a public asset under a content-hashed name: app.css → assets/app.<hash>.css.
 * New content ⇒ new URL, so a cached copy never has to be invalidated and can live
 * for a year. Cache-Control is set on the OBJECT: the edge only caches what the
 * origin says is cacheable.
 */
export async function publishAsset(s3: S3Client, bucket: string, name: string, body: string | Buffer, contentType: string) {
  const ext = extname(name);
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
  const key = `assets/${name.slice(0, -ext.length)}.${hash}${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
  return key;
}
