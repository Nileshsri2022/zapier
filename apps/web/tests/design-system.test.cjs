/**
 * Design-system guards for the strip phase (see reports/skills-redesign-report.md).
 *
 * These are the two invariants the redesign is built on — they are cheap to check
 * from source and silently rot the moment someone pastes a utility string back in.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.resolve(__dirname, '..');
const walk = (dir, filter, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, acc);
    else if (filter.test(entry.name)) acc.push(full);
  }
  return acc;
};

const cssFiles = walk(path.join(WEB, 'styles'), /\.css$/);
assert.ok(cssFiles.length >= 10, 'styles directory should be discovered');

test('raw colors live only in tokens.css', () => {
  const offenders = [];
  for (const file of cssFiles) {
    if (path.basename(file) === 'tokens.css') continue;
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const code = line.replace(/\/\*.*?\*\//g, '');
        // Catches hex literals; hsl(var(--token)) and rgb(0 0 0 / alpha) are fine.
        if (/#[0-9a-fA-F]{3,8}\b/.test(code)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], `raw color values must live in styles/tokens.css:\n${offenders.join('\n')}`);
});

// Tailwind utility shapes that must not reappear in first-party markup.
const UTILITY =
  /^(?:bg-(blue|red|green|yellow|purple|gray|orange|white|black|base)(-\d{2,3})?|text-(blue|red|green|yellow|purple|gray|amber|orange|white|black)(-\d{2,3})?|border-(blue|red|green|yellow|purple|gray)(-\d{2,3})?|space-[xy]-\d|animate-spin|min-h-screen|w-screen|h-screen|size-\d|p-\d|px-\d|py-\d|m-\d|mt-\d|mb-\d|gap-\d|rounded(-\w+)?|flex|flex-col|grid|grid-cols-\d|table|hidden|block|inline-flex|inline-block|items-\w+|justify-\w+|sr-only|peer|capitalize|truncate|(sm|md|lg|xl):[\w[\]()./-]+|(hover|focus|peer-checked|after|before|disabled):[\w[\]()./'-]+)$/;

test('first-party markup carries no Tailwind utility strings', () => {
  const offenders = [];
  for (const file of walk(WEB, /\.tsx?$/)) {
    // components/ui/* is the vendored shadcn layer — the documented exception.
    if (file.includes(`${path.sep}ui${path.sep}`)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const token of (match[1] || match[2] || '').split(/\s+/)) {
        if (token && UTILITY.test(token)) {
          offenders.push(`${path.relative(WEB, file)}: ${token}`);
        }
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `styles belong in styles/**, not in TSX:\n${[...new Set(offenders)].join('\n')}`
  );
});

test('semantic classes used by first-party markup are defined in a stylesheet', () => {
  const styles = cssFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const defined = new Set(
    [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])
  );
  const missing = new Set();
  for (const file of walk(WEB, /\.tsx?$/)) {
    if (file.includes(`${path.sep}ui${path.sep}`)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/className="([^"]*)"/g)) {
      for (const token of match[1].split(/\s+/)) {
        // Only design-system shaped names (block, block__element, block--modifier).
        if (!token || !/[-_]/.test(token)) continue;
        if (!defined.has(token)) missing.add(token);
      }
    }
  }
  assert.deepEqual(
    [...missing],
    [],
    'every className with a design-system prefix needs a rule in styles/**'
  );
});
