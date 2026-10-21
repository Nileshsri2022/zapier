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
const SUITES = [
  ['apps', 'server'],
  ['apps', 'worker'],
  ['apps', 'hooks'],
  ['apps', 'processor'],
  ['apps', 'web'],
  // Shared modules carry suites too — @repo/ingress owns every ingress
  // verification decision and @repo/placeholders owns placeholder resolution,
  // so neither table may be skipped.
  ['packages', 'placeholders'],
  ['packages', 'ingress'],
];

const results = [];
for (const [group, name] of SUITES) {
  const label = group === 'apps' ? name : `${name} (packages)`;
  process.stdout.write(`\n── ${label} ${'─'.repeat(Math.max(0, 50 - label.length))}\n`);
  try {
    execSync('npm test --silent', { cwd: join(ROOT, group, name), stdio: 'inherit' });
    results.push([label, 'pass']);
  } catch {
    results.push([label, 'FAIL']);
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
