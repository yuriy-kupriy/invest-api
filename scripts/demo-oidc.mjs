// HW #32 demo:oidc — the pipeline's OIDC gate on three tokens signed by a key
// pair generated right now, with this process acting as the issuer
// (openid-configuration + JWKS on 127.0.0.1). No GitHub, no cloud.
//   green          valid signature, allowed sub   -> sig-verified=1 policy-allow=1
//   foreign-sub    valid signature, someone else's repo -> 1 0
//   bad-signature  green payload, signature tampered     -> 0 0
// Exit 0 only when the gate gave exactly those verdicts.
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const POLICY = 'oidc/policy.json';
const policy = JSON.parse(readFileSync(POLICY, 'utf8'));
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = randomUUID();
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };

const server = http.createServer((req, res) => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const body =
    req.url === '/.well-known/openid-configuration' ? { issuer: base, jwks_uri: `${base}/jwks` }
    : req.url === '/jwks' ? { keys: [jwk] }
    : null;
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? {}));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const issuer = `http://127.0.0.1:${server.address().port}`;
const audience = policy.aud;

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims) {
  const signingInput = `${enc({ alg: 'RS256', typ: 'JWT', kid })}.${enc(claims)}`;
  return `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;
}
const now = Math.floor(Date.now() / 1000);
const base = { iss: issuer, aud: audience, iat: now, nbf: now, exp: now + 300 };
const allowedSub = policy.sub[0];
const [owner, repo] = allowedSub.replace(/^repo:/, '').split(':')[0].split('/');

const green = jwt({ ...base, sub: allowedSub });
const tampered = green.slice(0, -6) + (green.endsWith('AAAAAA') ? 'BBBBBB' : 'AAAAAA');
const cases = [
  ['green', green, '1', '1'],
  ['foreign-sub', jwt({ ...base, sub: allowedSub.replace(`${owner}/${repo}`, `attacker-${owner}/${repo}`) }), '1', '0'],
  ['bad-signature', tampered, '0', '0'],
];

const dir = mkdtempSync(join(tmpdir(), 'oidc-demo-'));
const run = promisify(execFile);
let ok = true;
try {
  for (const [name, token, wantSig, wantAllow] of cases) {
    const file = join(dir, `${name}.jwt`);
    writeFileSync(file, token, { mode: 0o600 });
    // The same gate the pipeline runs; only issuer/audience/policy are parameters.
    const out = await run(process.execPath, ['scripts/oidc-gate.mjs', '--token-file', file, '--policy', POLICY,
      '--issuer', issuer, '--audience', audience]).then((r) => r.stdout, (e) => e.stdout);
    const got = Object.fromEntries(out.trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)));
    console.log(`case=${name}`);
    console.log(out.trim());
    ok &&= got['sig-verified'] === wantSig && got['policy-allow'] === wantAllow;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  server.close();
}
console.log(`demo=${ok ? 'pass' : 'fail'}`);
process.exit(ok ? 0 : 1);
