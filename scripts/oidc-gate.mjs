// HW #32 OIDC gate. Verifies a JWT the way a cloud's STS would before handing out
// credentials: signature by a key from the issuer's JWKS, then iss / aud / exp /
// nbf, then sub against the trust policy file. Prints the claims it decided on,
// never the token. Exit 0 only when the policy allows.
//
//   node scripts/oidc-gate.mjs --token-file <f> [--policy oidc/policy.json]
//        [--issuer <iss>] [--audience <aud>] [--jwks-uri <url>]
//
// --issuer / --audience override the policy file (demo:oidc runs its own issuer);
// without --jwks-uri the set is discovered from <issuer>/.well-known/openid-configuration.
import { createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: arg } = parseArgs({
  options: {
    'token-file': { type: 'string' },
    policy: { type: 'string', default: 'oidc/policy.json' },
    issuer: { type: 'string' },
    audience: { type: 'string' },
    'jwks-uri': { type: 'string' },
  },
});
if (!arg['token-file']) {
  console.error('usage: oidc-gate.mjs --token-file <file> [--policy] [--issuer] [--audience] [--jwks-uri]');
  process.exit(2);
}

const policy = JSON.parse(readFileSync(arg.policy, 'utf8'));
const issuer = arg.issuer ?? policy.iss;
const audience = arg.audience ?? policy.aud;
const allowedSubs = policy.sub;
if (!issuer || !audience || !Array.isArray(allowedSubs) || allowedSubs.length === 0) {
  console.error('policy needs iss, aud and a non-empty sub list');
  process.exit(2);
}

const b64json = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
const token = readFileSync(arg['token-file'], 'utf8').trim();
const parts = token.split('.');
if (parts.length !== 3) {
  console.error('not a JWS compact token');
  process.exit(2);
}
const [h, p, sig] = parts;
const header = b64json(h);
const claims = b64json(p);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

// 1. Signature. Only RS256 — the alg comes from our allowlist, never trusted
// from the header alone ("none" / HS256-with-the-public-key attacks).
let sigVerified = 0;
if (header.alg === 'RS256' && header.kid) {
  const jwksUri = arg['jwks-uri'] ?? (await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`)).jwks_uri;
  const { keys } = await getJson(jwksUri);
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (jwk) {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    sigVerified = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(sig, 'base64url')) ? 1 : 0;
  }
}

// 2. Claims and the trust policy — only meaningful on a verified token.
const now = Math.floor(Date.now() / 1000);
const auds = [].concat(claims.aud ?? []);
const checks = {
  iss: claims.iss === issuer,
  aud: auds.includes(audience),
  exp: typeof claims.exp === 'number' && claims.exp > now,
  nbf: claims.nbf === undefined || claims.nbf <= now + 60,
  // Exact match: the sub condition is the line between my repo and anyone else's.
  sub: allowedSubs.includes(claims.sub),
};
const allow = sigVerified === 1 && Object.values(checks).every(Boolean) ? 1 : 0;

console.log(`iss=${claims.iss ?? ''}`);
console.log(`aud=${auds.join(',')}`);
console.log(`sub=${claims.sub ?? ''}`);
console.log(`sig-verified=${sigVerified}`);
console.log(`policy-allow=${allow}`);
if (!allow) {
  const failed = sigVerified ? Object.keys(checks).filter((k) => !checks[k]) : ['signature'];
  console.log(`deny-reason=${failed.join(',')}`);
}
process.exit(allow ? 0 : 1);
