const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

/**
 * `apps/web` is TypeScript but its suite is `node --test` on .cjs, so the
 * helper is transpiled in-process. Testing the decision (not the rendered
 * markup) keeps the test about behaviour: which Zaps are offered an ingress
 * URL at all.
 */
function loadHelper() {
  const file = join(__dirname, '../lib/webhookUrl.ts');
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(join(__dirname, '..'));
  loaded._compile(outputText, file);
  return loaded.exports;
}

const HOOKS = 'https://hooks.example.com';
const USER = 42;

const zapWith = (triggerType, prodHookId) => ({
  id: 'zap-1',
  userId: USER,
  triggerType,
  prodHookId,
});

test('offers the hook URL for a Webhook-triggered Zap', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(webhookUrlFor(zapWith('Webhook'), HOOKS), `${HOOKS}/hooks/42/zap-1`);
});

test('appends a rotated prod hook id when the trigger carries one', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(
    webhookUrlFor(zapWith('Webhook', 'prod-hook-9'), HOOKS),
    `${HOOKS}/hooks/42/zap-1/prod-hook-9`
  );
});

test('offers no hook URL for a Schedule-triggered Zap', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(webhookUrlFor(zapWith('Schedule Every Hour'), HOOKS), null);
});

for (const triggerType of [
  'Gmail New Email',
  'GitHub Push',
  'Google Sheets New Row',
  'Google Calendar New Event',
  'WhatsApp Message Received',
  'Telegram New Message',
]) {
  test(`offers no hook URL for a ${triggerType} Zap`, () => {
    const { webhookUrlFor } = loadHelper();

    assert.equal(webhookUrlFor(zapWith(triggerType), HOOKS), null);
  });
}

test('offers no hook URL when the trigger type is missing', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(webhookUrlFor(zapWith(undefined), HOOKS), null);
  assert.equal(webhookUrlFor({ id: 'zap-1', userId: USER }, HOOKS), null);
});

test('offers no hook URL without a user id', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(webhookUrlFor({ ...zapWith('Webhook'), userId: null }, HOOKS), null);
  assert.equal(webhookUrlFor({ ...zapWith('Webhook'), userId: undefined }, HOOKS), null);
});

test('treats a user id of 0 as a real id', () => {
  const { webhookUrlFor } = loadHelper();

  assert.equal(
    webhookUrlFor({ ...zapWith('Webhook'), userId: 0 }, HOOKS),
    `${HOOKS}/hooks/0/zap-1`
  );
});
