/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  setupFiles: ['<rootDir>/../jest.setup.js'],
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  // Pinned, not left to Jest 30's detectAgent(): without it some environments
  // pick the compact `agent` reporter, which prints neither PASS <file> nor the
  // test names, and the output stops being comparable between machines.
  reporters: ['default'],
  // One container per worker is one container too many — every suite that
  // reaches for testcontainers shares a single postgres.
  maxWorkers: 1,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
