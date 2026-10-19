const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const threads = require('node:worker_threads');
const { callPuter } = require('../dist/puter');
const request = {
  provider: 'puter',
  model: 'test',
  apiKey: 'token',
  system: 'system',
  input: 'input',
  temperature: 0,
  maxOutputTokens: 500,
  timeoutMs: 50,
  maxResponseBytes: 1024,
  allowedHosts: [],
};
function mockWorker(t, onStart) {
  const original = threads.Worker;
  const calls = [];
  threads.Worker = class extends EventEmitter {
    constructor(file, options) {
      super();
      this.stdout = { resume() {} };
      this.stderr = { resume() {} };
      this.terminated = false;
      calls.push({ file, options, worker: this });
      queueMicrotask(() => onStart(this));
    }
    async terminate() {
      this.terminated = true;
      return 0;
    }
  };
  t.after(() => {
    threads.Worker = original;
  });
  return calls;
}

test('Puter uses isolated documented SDK entrypoint thread and terminates on completion', async (t) => {
  const calls = mockWorker(t, (worker) =>
    worker.emit('message', { ok: true, result: { text: 'Summary' } })
  );
  const output = await callPuter(request);
  assert.equal(output.text, 'Summary');
  assert.equal(calls[0].worker.terminated, true);
  assert.match(calls[0].file, /puterThread\.js$/);
  assert.deepEqual(calls[0].options.env, {});
  assert.equal(calls[0].options.workerData.apiKey, 'token');
  assert.equal(calls[0].options.stdout, true);
  assert.equal(calls[0].options.resourceLimits.maxOldGenerationSizeMb, 128);
});

test('Puter timeout terminates the worker and is retryable; unknown SDK errors are fatal/redacted', async (t) => {
  const calls = mockWorker(t, () => {});
  await assert.rejects(
    callPuter({ ...request, timeoutMs: 5 }),
    (e) => e.retryable && /timed out/.test(e.message)
  );
  assert.equal(calls[0].worker.terminated, true);
  threads.Worker = class extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('error', Error('LEAK_TOKEN')));
    }
    async terminate() {
      return 0;
    }
  };
  await assert.rejects(
    callPuter(request),
    (e) => !e.retryable && !e.message.includes('LEAK_TOKEN')
  );
});
