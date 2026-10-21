#!/usr/bin/env node
/**
 * Generate the Prisma client after install.
 *
 * CI already does this (`cd packages/db && bunx prisma generate`), but nothing
 * did it locally — so `@repo/db` could not resolve `@prisma/client`, a whole
 * jest suite failed to *load*, and typecheck counts shifted depending on
 * whether anyone had run generate. Doing it at postinstall keeps local and CI
 * state aligned.
 *
 * Never fails the install: offline installs and sandboxes without the engine
 * download must still succeed. It warns loudly instead of passing silently.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_DIR = join(ROOT, 'packages', 'db');
const SCHEMA = join(DB_DIR, 'prisma', 'schema.prisma');
const MARKERS = [
  join(ROOT, 'node_modules', '.prisma', 'client', 'index.d.ts'),
  join(DB_DIR, 'node_modules', '.prisma', 'client', 'index.d.ts'),
];
const FORCE = process.argv.includes('--force');

if (process.env.SKIP_PRISMA_GENERATE) process.exit(0);
if (!FORCE && MARKERS.some(existsSync)) process.exit(0);

const candidates = [
  [join(ROOT, 'node_modules', '.bin', 'prisma'), ['generate', `--schema=${SCHEMA}`]],
  ['npx', ['--no-install', 'prisma', 'generate', `--schema=${SCHEMA}`]],
];

for (const [command, args] of candidates) {
  if (command.includes('node_modules') && !existsSync(command)) continue;
  try {
    execFileSync(command, args, { cwd: DB_DIR, stdio: 'pipe' });
    console.log('✓ Prisma client generated');
    process.exit(0);
  } catch {
    // try the next strategy
  }
}

console.warn(
  [
    '',
    '⚠ Prisma client NOT generated — `@repo/db` imports will fail to resolve.',
    '  This is expected on offline installs. When you have network, run:',
    '      npm run generate',
    '  (skip this hook with SKIP_PRISMA_GENERATE=1)',
    '',
  ].join('\n')
);
process.exit(0);
