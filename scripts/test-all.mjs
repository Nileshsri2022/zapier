#!/usr/bin/env node
/**
 * Run every app's test suite the same way CI does, in one command.
 *
 * Without this, the incantation has to be rediscovered each session: each app
 * owns its own jest config, so plain `npx jest` from the root fails with
 * "Preset ts-jest not found". apps/web uses node:test instead of jest.
 */
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['server', 'worker', 'hooks', 'processor', 'web'];

const results = [];
for (const app of APPS) {
  process.stdout.write(`\n── ${app} ${'─'.repeat(Math.max(0, 50 - app.length))}\n`);
  try {
    execSync('npm test --silent', { cwd: join(ROOT, 'apps', app), stdio: 'inherit' });
    results.push([app, 'pass']);
  } catch {
    results.push([app, 'FAIL']);
  }
}

console.log('\n── summary ─────────────────────────────────────────');
for (const [app, status] of results)
  console.log(`  ${status === 'pass' ? '✓' : '✗'} ${app}: ${status}`);

if (results.some(([, status]) => status !== 'pass')) {
  console.error('\n✗ some suites failed');
  process.exit(1);
}
console.log('\n✓ all suites passed');
