// Перевірка обсягу спеки — та сама, що в acceptance criteria ДЗ, лише винесена у файл.
// Читає збандлену spec.json, а не yaml: критерій дивиться на operation-level parameters
// після бандлу, і саме тому Idempotency-Key описаний у спеці inline, а не через $ref.
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

console.log('операцій:', ops.length, '· ресурсів:', resources);
console.log('Idempotency-Key: required =', idem?.required, '· опис, символів =', idemDescLength);

const failures = [];
if (ops.length < 5) failures.push(`операцій ${ops.length}, треба ≥ 5`);
if (resources < 2) failures.push(`ресурсів ${resources}, треба ≥ 2`);
if (idem?.required !== true) failures.push('Idempotency-Key не required: true');
if (idemDescLength < 40) failures.push(`опис Idempotency-Key ${idemDescLength} символів, треба ≥ 40`);

if (failures.length > 0) {
  console.error('\nПРОВАЛЕНО:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\nОбсяг спеки витримано.');
