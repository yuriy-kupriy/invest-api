// HW #32 gate, step 3: "modules do not reach into each other" as a check.
// A feature module (src/<name>/) talks to another one through its service,
// repository or module — never through its HTTP/WS edge (controller, gateway).
// domain/ (pure business rules) depends on no feature module at all.
// Entities are exempt from no-circular: TypeORM relations point both ways by design.
const FEATURES = '(accounts|auth|broker|concurrency|currencies|files|fx-rates|health|orders|redis|transactions)';
const ROOT = '^(?:src|gates/fixtures/arch/src)';

module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: { pathNot: `${ROOT}/entities/` }, to: { circular: true } },
    {
      name: 'domain-stays-pure',
      comment: 'domain/ must not depend on a feature module',
      severity: 'error',
      from: { path: `${ROOT}/domain/` },
      to: { path: `${ROOT}/${FEATURES}/` },
    },
    {
      name: 'no-foreign-edge',
      comment: "a module must not import another module's controller or gateway",
      severity: 'error',
      from: { path: `${ROOT}/([^/]+)/` },
      to: { path: `${ROOT}/${FEATURES}/[^/]+\\.(controller|gateway)\\.ts$`, pathNot: `${ROOT}/$1/` },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};
