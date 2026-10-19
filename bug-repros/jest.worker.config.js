// Jest config for the bug-repro harness (apps/worker sources).
module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/bug-repros/worker'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/bug-repros/tsconfig.commonjs.json' }] },
  moduleNameMapper: {
    '^@repo/(.*)$': '<rootDir>/packages/$1/src',
    // src/index.ts uses ESM-style dynamic imports (`await import('./sendWebhook.js')`);
    // map them back to the .ts source so jest.mock() can intercept them.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['<rootDir>/apps/worker/tests/setup.ts'],
};
