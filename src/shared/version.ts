import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readVersion(): string {
  try {
    // dist/shared/ and src/shared/ are both two levels below package.json.
    const pkg = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(pkg) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * One version for the whole app: /health reports it and the Swagger document is
 * built with it, so `npm version` moves both instead of leaving /docs behind.
 */
export const VERSION = readVersion();
