import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express, { Express } from 'express';
import { s3Status } from './storage';

/**
 * HW #26: the local stand-in for CloudFront + OAC. The bucket is private; the
 * edge reads it with its own credentials and the public only ever talks to the
 * edge. Caches in memory, and only what the origin marked public with a max-age.
 */
interface Entry {
  body: Buffer;
  headers: Record<string, string>;
  expires: number;
}

export function edgeApp(s3: S3Client, bucket: string): Express {
  // shortcut: unbounded in-memory cache, demo only; use nginx proxy_cache or CloudFront in prod.
  const cache = new Map<string, Entry>();
  const app = express();

  // Only assets/ is public: uploads/ stays reachable through presigned URLs alone.
  app.get(/^\/assets\/.+/, async (req, res) => {
    const key = req.path.slice(1);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      res.set({ ...hit.headers, 'X-Cache': 'HIT' }).send(hit.body);
      return;
    }
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = Buffer.from(await obj.Body!.transformToByteArray());
      const headers: Record<string, string> = { 'Content-Type': obj.ContentType ?? 'application/octet-stream' };
      if (obj.CacheControl) headers['Cache-Control'] = obj.CacheControl;
      const maxAge = /(?:^|,)\s*public\b/.test(obj.CacheControl ?? '') && /max-age=(\d+)/.exec(obj.CacheControl ?? '');
      if (maxAge) cache.set(key, { body, headers, expires: Date.now() + Number(maxAge[1]) * 1000 });
      res.set({ ...headers, 'X-Cache': 'MISS' }).send(body);
    } catch (err) {
      const status = s3Status(err);
      res.status(status === 404 || status === 403 ? 404 : 502).end();
    }
  });
  return app;
}
