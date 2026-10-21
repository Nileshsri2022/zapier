#!/usr/bin/env node
/**
 * Typecheck ratchet.
 *
 * `tsc --noEmit` reports pre-existing errors in this repo (unbuilt workspace
 * packages, an ungenerated Prisma client, legacy implicit-any debt). With no
 * recorded baseline those numbers drift with the environment — the same commit
 * can report 38 or 46 errors depending on whether `packages/types/dist` and
 * `.prisma/client` exist — which makes "did I break something?" unanswerable.
 *
 * This script freezes the known-bad error *signatures* (file + TS code, never
 * line numbers, which move for harmless reasons) and fails only when a NEW
 * signature appears. Fixing errors is always allowed: shrinking the set is a
 * win, not a mismatch.
 *
 *   node scripts/typecheck-ratchet.mjs           # fail on new errors
 *   node scripts/typecheck-ratchet.mjs --update  # accept current state
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = join(ROOT, 'tsc-baseline.json');
const APPS = ['server', 'worker', 'hooks', 'processor', 'web'];
const UPDATE = process.argv.includes('--update');

const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc');

function ensureWorkspaceTypesBuilt() {
  // apps/web imports @repo/types from dist. Without it, typecheck invents a
  // pile of TS2307 that has nothing to do with the change under review.
  const marker = join(ROOT, 'packages', 'types', 'dist', 'index.d.ts');
  if (existsSync(marker)) return;
  console.warn('· building packages/types (dist missing — required for stable typecheck)');
  execFileSync(tscBin, [], { cwd: join(ROOT, 'packages', 'types'), stdio: 'inherit' });
}

function warnIfPrismaMissing() {
  const markers = [
    join(ROOT, 'node_modules', '.prisma', 'client', 'index.d.ts'),
    join(ROOT, 'packages', 'db', 'node_modules', '.prisma', 'client', 'index.d.ts'),
  ];
  if (markers.some(existsSync)) return;
  console.warn(
    '· .prisma/client is not generated — packages/db reports TS2305. ' +
      'Run `npm run generate` for a cleaner count (the ratchet tolerates both states).'
  );
}

/** "path(line,col): error TS2307: msg" → { sig: "path|TS2307", line: original } */
function signature(line) {
  const match = line.match(/^(.*?)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
  if (!match) return null;
  const file = relative(ROOT, match[1]).split('\\').join('/');
  return { sig: `${file}|${match[4]}`, detail: line.trim() };
}

function errorsFor(app) {
  const project = join(ROOT, 'apps', app, 'tsconfig.json');
  if (!existsSync(project)) return [];
  let output = '';
  try {
    output = execFileSync(tscBin, ['--noEmit', '-p', project], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // tsc exits non-zero when it finds errors; the report is on stdout.
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  return output.split('\n').map(signature).filter(Boolean);
}

if (!existsSync(tscBin)) {
  console.error('✗ TypeScript not installed. Run `npm install --ignore-scripts` first.');
  process.exit(2);
}

ensureWorkspaceTypesBuilt();
warnIfPrismaMissing();

const current = {};
for (const app of APPS) {
  const found = errorsFor(app);
  current[app] = [...new Set(found.map((entry) => entry.sig))].sort();
}

const total = Object.values(current).reduce((sum, list) => sum + list.length, 0);

if (UPDATE) {
  writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify(
      {
        note:
          'Known-bad typecheck signatures (file|TSxxxx). The ratchet fails on NEW signatures only; ' +
          'run `npm run typecheck:update` after fixing errors to shrink this set.',
        apps: current,
      },
      null,
      2
    )}\n`
  );
  console.log(`✓ baseline written: ${total} known signature(s) across ${APPS.length} apps`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  console.error('✗ tsc-baseline.json missing. Run `npm run typecheck:update` once to create it.');
  process.exit(2);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).apps ?? {};
const regressions = [];

for (const app of APPS) {
  const known = new Set(baseline[app] ?? []);
  const found = current[app] ?? [];
  const added = found.filter((sig) => !known.has(sig));
  const fixed = [...known].filter((sig) => !found.includes(sig));
  if (added.length) regressions.push([app, added]);
  if (fixed.length)
    console.log(
      `  ${app}: ${fixed.length} baseline error(s) fixed — run \`npm run typecheck:update\` to bank it`
    );
}

const baselineTotal = Object.values(baseline).reduce((sum, list) => sum + list.length, 0);
console.log(`· typecheck: ${total} error(s) now, ${baselineTotal} in baseline`);

if (regressions.length) {
  console.error('\n✗ NEW typecheck errors (not in the baseline):\n');
  for (const [app, added] of regressions) {
    console.error(`  ${app}:`);
    for (const sig of added) console.error(`    + ${sig}`);
  }
  console.error(
    '\nFix these, or — if they are legitimately pre-existing in your environment — ' +
      'run `npm run typecheck:update` and say why in the PR.'
  );
  process.exit(1);
}

console.log('✓ no new typecheck errors');
