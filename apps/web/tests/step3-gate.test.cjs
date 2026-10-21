const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');

// Load the pure gate module directly — no React, no axios, no DOM.
function loadStep3() {
  const filename = path.resolve(__dirname, '../components/modal/step3.ts');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod._compile(js, filename);
  return mod.exports;
}

const { needsMetadataStep } = loadStep3();

const TRIGGER = 1;
const ACTION = 2;

test('#43: Webhook and GitHub triggers open their configuration form', () => {
  assert.equal(needsMetadataStep('Webhook', TRIGGER), true);
  assert.equal(needsMetadataStep('GitHub Push', TRIGGER), true);
  assert.equal(needsMetadataStep('GitHub Pull Request', TRIGGER), true);
});

test('#42: WhatsApp, Telegram and Webhook actions open their configuration form', () => {
  assert.equal(needsMetadataStep('WhatsApp Send Message', ACTION), true);
  assert.equal(needsMetadataStep('WhatsApp', ACTION), true);
  assert.equal(needsMetadataStep('Telegram Send Message', ACTION), true);
  assert.equal(needsMetadataStep('Webhook', ACTION), true);
});

test('WhatsApp triggers do not open step 3 — the server is picked in the account step', () => {
  assert.equal(needsMetadataStep('WhatsApp Message Received', TRIGGER), false);
});

test('controls that always had a form keep it', () => {
  for (const type of [
    'Gmail New Email',
    'Google Sheets New Row',
    'Google Calendar Event Created',
    'Schedule Daily',
    'Email',
    'Solana',
    'AI Transform',
    'Telegram New Message',
  ]) {
    assert.equal(needsMetadataStep(type, TRIGGER), true, `${type} trigger`);
  }
  for (const type of [
    'Gmail Send Email',
    'Email',
    'Solana',
    'AI Transform',
    'Discord Send Message',
  ]) {
    assert.equal(needsMetadataStep(type, ACTION), true, `${type} action`);
  }
});

test('unknown and empty types never open a form', () => {
  assert.equal(needsMetadataStep(undefined, TRIGGER), false);
  assert.equal(needsMetadataStep(null, ACTION), false);
  assert.equal(needsMetadataStep('', TRIGGER), false);
  assert.equal(needsMetadataStep('SomeFutureApp', ACTION), false);
});
