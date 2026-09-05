// Checks the spec scope: the same test as in the homework acceptance criteria,
// just extracted to a file. Reads the bundled spec.json, not the yaml: the criterion
// looks at operation-level parameters after bundling, which is why Idempotency-Key
// is described inline in the spec, not via $ref.
const s = require('../spec.json');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const ops = Object.entries(s.paths).flatMap(([p, v]) =>
  Object.keys(v)
    .filter((m) => METHODS.includes(m))
    .map((m) => [p, m]),
);

const resources = new Set(Object.keys(s.paths).map((p) => p.split('/')[1])).size;

const idem = ops
  .flatMap(([p, m]) => s.paths[p][m].parameters ?? [])
  .find((x) => x.in === 'header' && /idempotency-key/i.test(x.name));

const idemDescLength = (idem?.description ?? '').trim().length;

console.log('operations:', ops.length, '· resources:', resources);
console.log('Idempotency-Key: required =', idem?.required, '· description length =', idemDescLength);

const failures = [];
if (ops.length < 5) failures.push(`operations ${ops.length}, need ≥ 5`);
if (resources < 2) failures.push(`resources ${resources}, need ≥ 2`);
if (idem?.required !== true) failures.push('Idempotency-Key not required: true');
if (idemDescLength < 40) failures.push(`Idempotency-Key description ${idemDescLength} chars, need ≥ 40`);

if (failures.length > 0) {
  console.error('\nFAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nSpec scope looks good.');
