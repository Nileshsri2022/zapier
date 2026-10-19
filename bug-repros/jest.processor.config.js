// Jest config for the bug-repro harness (apps/processor sources).
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/bug-repros/processor'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/bug-repros/tsconfig.commonjs.json' }] },
  moduleNameMapper: {
    '^@repo/(.*)$': '<rootDir>/packages/$1/src',
    // Pin to the copy apps/processor resolves, so jest.mock('googleapis') in a
    // repro applies to the same module the source under test imports.
    '^googleapis$': '<rootDir>/apps/processor/node_modules/googleapis',
  },
};
