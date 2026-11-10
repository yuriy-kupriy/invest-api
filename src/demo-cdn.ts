import { finish, listen, run } from './demo-kit';
import { publishAsset } from './files/assets';
import { edgeApp } from './files/edge';
import { ensureBucket, purgePrefix, s3Client, storageEnv } from './files/storage';

/**
 * HW #26 demo:cdn — the bucket is closed (anonymous GET → 403), assets are
 * served through the edge (MISS, then HIT), and a "deploy" ships new content
 * under a new hashed name: zero invalidations.
 */
const V1 = 'body{color:#1f6feb}\n';
const V2 = 'body{color:#d1242f}\n';

async function main() {
  const cfg = storageEnv();
  const s3 = s3Client(cfg);
  const bucket = cfg.STORAGE_BUCKET;
  await ensureBucket(s3, bucket);
  await purgePrefix(s3, bucket, 'assets/');

  const key1 = await publishAsset(s3, bucket, 'app.css', V1, 'text/css');
  console.log(`published ${key1}`);

  // Anonymous, straight to storage, past the edge.
  const origin = cfg.STORAGE_ENDPOINT
    ? `${cfg.STORAGE_ENDPOINT}/${bucket}`
    : `https://${bucket}.s3.${cfg.STORAGE_REGION}.amazonaws.com`;
  const direct = await fetch(`${origin}/${key1}`);

  const edge = await listen(edgeApp(s3, bucket), '');
  try {
    const miss = await fetch(`${edge.url}/${key1}`);
    await miss.arrayBuffer();
    const hit = await fetch(`${edge.url}/${key1}`);
    const body1 = await hit.text();
    console.log(`x-cache: ${miss.headers.get('x-cache')} → ${hit.headers.get('x-cache')}`);

    // "Deploy": new content, new name. The old cache entry is left alone.
    const key2 = await publishAsset(s3, bucket, 'app.css', V2, 'text/css');
    console.log(`published ${key2}`);
    const fresh = await fetch(`${edge.url}/${key2}`);
    const body2 = await fresh.text();
    const old = await fetch(`${edge.url}/${key1}`);
    await old.arrayBuffer();

    const cacheHit = miss.headers.get('x-cache') === 'MISS' && hit.headers.get('x-cache') === 'HIT' ? 1 : 0;
    const newName = key2 !== key1 ? 1 : 0;
    const changed = body2 === V2 && body1 === V1 ? 1 : 0;
    finish(
      {
        direct: direct.status,
        'edge-miss': miss.status,
        'edge-hit': hit.status,
        'cache-hit': cacheHit,
        'new-name': newName,
        'new-url': fresh.status,
        'content-changed': changed,
        'old-url-still-hit': old.headers.get('x-cache') === 'HIT' ? 1 : 0,
        invalidations: 0,
      },
      [
        direct.status !== 403 && `anonymous GET on the bucket answered ${direct.status}, expected 403`,
        miss.status !== 200 && `edge miss answered ${miss.status}`,
        hit.status !== 200 && `edge hit answered ${hit.status}`,
        cacheHit !== 1 && 'second request did not come from the cache (Cache-Control on the object?)',
        newName !== 1 && 'new content kept the old name',
        fresh.status !== 200 && `new URL answered ${fresh.status}`,
        changed !== 1 && 'new URL did not serve the new content',
      ],
    );
  } finally {
    await edge.close();
  }
}

run(main);
