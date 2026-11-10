import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { runDemo, USERS } from './demo-auth-kit';
import { client, grab, tempFile } from './files/demo-files-kit';
import { ensureBucket, presignPut, purgePrefix, s3Client, storageEnv } from './files/storage';

/**
 * HW #26 demo:upload — the bytes go past our service: intent, then the API is
 * shut down and a key-less process PUTs straight into storage, then commit on a
 * restarted API. Plus: commit without bytes is refused, a presigned URL with a
 * swapped key or past its expiry is 403.
 */
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(1024, 7)]);

/** Raw TCP probe, not fetch: fetch's keep-alive pool can lie about a dead port. */
function alive(port: number): Promise<number> {
  return new Promise((resolve) => {
    const sock = connect(port, '127.0.0.1');
    sock.once('connect', () => (sock.destroy(), resolve(1)));
    sock.once('error', () => resolve(0));
  });
}

const put = (url: string, body: Buffer) => fetch(url, { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': 'image/png' } });

runDemo(
  {
    intent: [200],
    'key-from-server': [1],
    'api-alive': [0],
    'put-offline': [200],
    commit: [200],
    'commit-without-bytes': [409],
    tampered: [403],
    oversize: [403],
    expired: [403],
  },
  async (api, app) => {
    const cfg = storageEnv();
    const s3 = s3Client(cfg);
    const prefix = `uploads/${USERS.owner.id}/`;
    await ensureBucket(s3, cfg.STORAGE_BUCKET);
    await purgePrefix(s3, cfg.STORAGE_BUCKET, prefix);

    const token = (await api.login(USERS.owner)).body.access_token;
    const file = tempFile('avatar.png', PNG);
    const intentBody = { filename: '../../etc/passwd', contentType: 'image/png', size: PNG.length };

    // 1. Intent with a hostile filename: the server picks the key.
    const intent = await api.call('POST', '/uploads/intent', { token, body: intentBody });
    const key: string = intent.body.key;
    const keyFromServer =
      new RegExp(`^${prefix}[0-9a-f-]{36}\\.png$`).test(key) && !/passwd|\.\./.test(key) ? 1 : 0;
    console.log(`key=${key}`);

    // 2. API down, then a process with no keys in its env uploads the bytes.
    const port = await app.stop();
    const apiAlive = await alive(port);
    const putOffline = grab((await client({ url: intent.body.uploadUrl, file, contentType: 'image/png' })).stdout, 'put');

    // 3. API back on a new port: commit sees the object with HeadObject.
    const api2 = await app.start();
    const commit = await api2.call('POST', '/uploads/commit', { token, body: { fileId: intent.body.fileId } });

    // 4. Commit with nothing uploaded.
    const empty = await api2.call('POST', '/uploads/intent', { token, body: intentBody });
    const commitEmpty = await api2.call('POST', '/uploads/commit', { token, body: { fileId: empty.body.fileId } });

    // 5. The signature covers the path: swap the key, keep the signature.
    const other = `${prefix}${randomUUID()}.png`;
    const tampered = await put(empty.body.uploadUrl.replace(empty.body.key, other), PNG);

    // 6. The size is signed too: announce 1 KB, try to push 1 MB through the same URL.
    const oversize = await put(empty.body.uploadUrl, Buffer.alloc(1024 * 1024, 7));

    // 7. Expiry: a 1-second URL, used after 2 seconds.
    const shortLived = await presignPut(s3, cfg.STORAGE_BUCKET, `${prefix}${randomUUID()}.png`, 'image/png', PNG.length, 1);
    await sleep(2_000);
    const expired = await put(shortLived, PNG);

    return {
      intent: intent.status,
      'key-from-server': keyFromServer,
      'api-alive': apiAlive,
      'put-offline': putOffline,
      commit: commit.status,
      'commit-without-bytes': commitEmpty.status,
      tampered: tampered.status,
      oversize: oversize.status,
      expired: expired.status,
    };
  },
);
