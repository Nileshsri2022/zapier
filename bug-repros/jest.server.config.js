// Jest config for the bug-repro harness (apps/server sources).
// Lives outside apps/*/tests on purpose: these tests are RED by design and
// must not be picked up by the app suites or CI until the bug is fixed.
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/bug-repros/server'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/bug-repros/tsconfig.commonjs.json' }] },
  moduleNameMapper: {
    '^@repo/(.*)$': '<rootDir>/packages/$1/src',
    // Pin to the copy apps/server resolves, so jest.mock('googleapis') in a
    // repro applies to the same module the source under test imports.
    '^googleapis$': '<rootDir>/apps/server/node_modules/googleapis',
  },
  setupFilesAfterEnv: ['<rootDir>/apps/server/tests/setup.ts'],
};
