import { createHash } from 'node:crypto';
import { runDemo, USERS } from './demo-auth-kit';
import { client, grab, head, tempFile } from './files/demo-files-kit';
import { ensureBucket, MIN_PART, purgePrefix, s3Client, storageEnv } from './files/storage';

/**
 * HW #26 demo:multipart — multipart is about resuming. A 3-part file; the first
 * uploader process dies after 2 parts; the object does not exist yet; a NEW
 * process asks the API (ListParts) what is missing and uploads 1 part; commit
 * completes it, and the ETag is "<md5 of part md5s>-3", not the file's MD5.
 */
const SIZE = 2 * MIN_PART + 1024 * 1024; // 5 + 5 + 1 MiB → 3 parts
const PARTS = 3;

runDemo(
  {
    'head-before-complete': [404],
    'resumed-parts': [1],
    complete: [200],
    'size-match': [1],
    'etag-multipart': [1],
  },
  async (api) => {
    const cfg = storageEnv();
    const s3 = s3Client(cfg);
    const bucket = cfg.STORAGE_BUCKET;
    // Clean slate: aborts leftover multipart uploads and deletes objects of earlier runs.
    await ensureBucket(s3, bucket);
    await purgePrefix(s3, bucket, `uploads/${USERS.owner.id}/`);

    const body = Buffer.alloc(SIZE);
    for (let i = 0; i < SIZE; i++) body[i] = (i * 31) & 0xff;
    const file = tempFile('dump.gz', body);

    const token = (await api.login(USERS.owner)).body.access_token;
    const intent = await api.call('POST', '/uploads/intent', {
      token,
      body: { filename: 'dump.gz', contentType: 'application/gzip', size: SIZE },
    });
    const { fileId, key, partSize, partCount, parts } = intent.body;
    console.log(`intent=${intent.status} part-size=${partSize} parts=${partCount}`);
    if (partCount !== PARTS) throw new Error(`expected ${PARTS} parts, intent planned ${partCount}`);

    // 1. First uploader: the connection drops after two parts.
    const first = await client({ parts, partSize, file, crashAfter: 2 });
    console.log(`first-process-exit=${first.code} first-uploaded=${grab(first.stdout, 'uploaded')}`);

    // 2. Parts are stored, the object is not.
    const before = await head(s3, bucket, key);

    // 3. A new process knows nothing; it asks what is missing and uploads only that.
    const second = await client({ base: api.base, token, fileId, file });
    const resumed = grab(second.stdout, 'uploaded');

    const commit = await api.call('POST', '/uploads/commit', { token, body: { fileId } });
    const after = await head(s3, bucket, key);
    const md5 = createHash('md5').update(body).digest('hex');
    console.log(`etag=${after.etag} file-md5=${md5}`);

    return {
      'head-before-complete': before.status,
      'resumed-parts': resumed,
      complete: commit.status,
      'size-match': after.size === SIZE ? 1 : 0,
      'etag-multipart': new RegExp(`-${PARTS}"$`).test(after.etag ?? '') && !after.etag?.includes(md5) ? 1 : 0,
    };
  },
);
