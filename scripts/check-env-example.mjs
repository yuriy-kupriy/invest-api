// Checks .env.example against the zod schema: the contract file must not fall
// behind the code. It reads the compiled schema from dist/, so it runs as
// `npm run check:env` (build + this script) and needs neither tsx nor ts-node.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { envSchema } = await import(join(root, 'dist', 'config', 'env.schema.js'));

const schemaKeys = Object.keys(envSchema.shape);

const exampleKeys = readFileSync(join(root, '.env.example'), 'utf8')
  .split('\n')
  .map((line) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line.trim()))
  .filter(Boolean)
  .map((match) => match[1]);

const duplicates = exampleKeys.filter((key, i) => exampleKeys.indexOf(key) !== i);
const missing = schemaKeys.filter((key) => !exampleKeys.includes(key));
const extra = exampleKeys.filter((key) => !schemaKeys.includes(key));

console.log('variables in schema:', schemaKeys.length, '· in .env.example:', exampleKeys.length);

const failures = [];
if (missing.length > 0) failures.push(`missing from .env.example: ${missing.join(', ')}`);
if (extra.length > 0) failures.push(`missing from the schema: ${extra.join(', ')}`);
if (duplicates.length > 0) failures.push(`duplicated in .env.example: ${[...new Set(duplicates)].join(', ')}`);

if (failures.length > 0) {
  console.error('\nFAILED:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('\n.env.example is in sync with the schema.');
