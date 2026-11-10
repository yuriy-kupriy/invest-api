import { DataSource } from 'typeorm';
import { AuthUser } from '@/auth/auth.types';
import { FilesService } from './files.service';

const user: AuthUser = { id: 'u1', role: 'member', jti: 'j', sid: 's', exp: 0 };
const SIZE = 11 * 1024 * 1024;

/** A row left PENDING with an upload_id by a commit that completed in S3 but stopped before the UPDATE. */
function setup(send: jest.Mock) {
  const row = { id: 'f1', key: 'uploads/u1/x.gz', owner_id: 'u1', status: 'PENDING', size: String(SIZE), upload_id: 'up1' };
  const query = jest.fn(async (sql: string) =>
    sql.startsWith('SELECT') ? [row] : [[{ ...row, status: 'COMPLETED', upload_id: null }], 1],
  );
  Object.assign(process.env, { STORAGE_ACCESS_KEY: 'k', STORAGE_SECRET_KEY: 's', STORAGE_BUCKET: 'bucket' });
  const service = new FilesService({ query } as unknown as DataSource);
  Object.assign(service, { s3: { send } });
  return service;
}

const named = (name: string) => Object.assign(new Error(name), { name });

describe('FilesService.commit', () => {
  it('finishes a multipart upload that an earlier commit already completed', async () => {
    const send = jest.fn(async (cmd: object) => {
      if (cmd.constructor.name === 'ListPartsCommand') throw named('NoSuchUpload');
      if (cmd.constructor.name === 'HeadObjectCommand') return { ContentLength: SIZE };
      throw new Error(`unexpected ${cmd.constructor.name}`);
    });
    await expect(setup(send).commit('f1', user)).resolves.toMatchObject({ status: 'COMPLETED', size: SIZE });
  });

  it('answers 409 for parts S3 refuses to join', async () => {
    const send = jest.fn(async (cmd: object) => {
      if (cmd.constructor.name === 'ListPartsCommand') {
        return { Parts: [1, 2, 3].map((n) => ({ PartNumber: n, ETag: `"e${n}"` })) };
      }
      throw named('EntityTooSmall');
    });
    await expect(setup(send).commit('f1', user)).rejects.toMatchObject({ status: 409 });
  });
});
