// Jest config for the bug-repro harness (packages/* sources).
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/bug-repros/packages'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/bug-repros/tsconfig.commonjs.json' }] },
  moduleNameMapper: {
    '^@repo/(.*)$': '<rootDir>/packages/$1/src',
  },
};
