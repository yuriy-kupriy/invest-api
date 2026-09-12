require('reflect-metadata');

// The env contract is enforced by the zod schema at bootstrap, so the test run
// has to satisfy it too. The pool is lazy — nothing connects to Postgres until a
// test actually hits /health/db — so these values only have to be well-formed.
process.env.NODE_ENV = 'test';
process.env.DB_URL = process.env.DB_URL || 'postgres://invest_app@localhost:5432/invest';
// Pinned, not defaulted: ConfigModule still loads the developer's real .env
// during a test run, and a local DRIFT=1 would otherwise flip the wire format
// under the e2e suite and fail transaction tests that have nothing to do with it.
process.env.DRIFT = '0';
