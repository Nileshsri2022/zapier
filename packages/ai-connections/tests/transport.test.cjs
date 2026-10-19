const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const { createCompatibleTransport } = require('../dist');
const options = {
  baseUrl: 'https://api.example.com/v1',
  allowedHosts: ['api.example.com'],
  apiKey: 'secret',
  body: { model: 'test' },
};
const resolver = async () => [{ address: '8.8.8.8', family: 4 }];

function mockRequest(t, respond) {
  const original = https.request;
  const calls = [];
  https.request = (settings, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => respond(callback, request));
    calls.push(settings);
    return request;
  };
  t.after(() => {
    https.request = original;
  });
  return calls;
}
function response(status) {
  const res = new EventEmitter();
  res.statusCode = status;
  res.destroy = () => {};
  return res;
}

test('pins validated IP while retaining original SNI, Host and certificate checks', async (t) => {
  const calls = mockRequest(t, (callback) => {
    const res = response(200);
    callback(res);
    res.emit('data', Buffer.from('{"ok":true}'));
    res.emit('end');
  });
  let resolutions = 0;
  const send = createCompatibleTransport(async () => {
    resolutions++;
    return resolver();
  });
  assert.equal((await send(options)).status, 200);
  assert.equal(calls[0].hostname, '8.8.8.8');
  assert.equal(calls[0].servername, 'api.example.com');
  assert.equal(calls[0].headers.Host, 'api.example.com');
  assert.equal(calls[0].rejectUnauthorized, true);
  assert.equal(calls[0].agent, false);
  assert.equal(calls[0].path, '/v1/chat/completions');
  await send(options);
  assert.equal(resolutions, 2);
});

test('never follows redirects or exposes raw upstream errors', async (t) => {
  const calls = mockRequest(t, (callback) => {
    const res = response(302);
    res.headers = { location: 'https://169.254.169.254' };
    callback(res);
  });
  await assert.rejects(createCompatibleTransport(resolver)(options), /request failed/);
  assert.equal(calls.length, 1);
});

test('enforces streamed response cap', async (t) => {
  mockRequest(t, (callback) => {
    const res = response(200);
    callback(res);
    res.emit('data', Buffer.alloc(11));
  });
  await assert.rejects(
    createCompatibleTransport(resolver)({ ...options, maxResponseBytes: 10 }),
    /bounds/
  );
});

test('DNS timeout does not dispatch after late resolution', async (t) => {
  const calls = mockRequest(t, () => {});
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const send = createCompatibleTransport(() => pending);
  await assert.rejects(send({ ...options, timeoutMs: 5 }), /bounds/);
  finish(await resolver());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
});

test('rebinding to a private destination on next request is blocked before Authorization dispatch', async (t) => {
  const calls = mockRequest(t, (callback) => {
    const res = response(200);
    callback(res);
    res.emit('end');
  });
  let count = 0;
  const send = createCompatibleTransport(async () => [
    { address: ++count === 1 ? '8.8.8.8' : '10.0.0.1', family: 4 },
  ]);
  await send(options);
  await assert.rejects(send(options));
  assert.equal(calls.length, 1);
});

test('limits concurrent calls and releases permits after timeout', async (t) => {
  mockRequest(t, () => {});
  const send = createCompatibleTransport(resolver);
  const pending = Array.from({ length: 10 }, () =>
    send({ ...options, timeoutMs: 10 }).catch(() => {})
  );
  await assert.rejects(send(options), /concurrency/);
  await Promise.all(pending);
  await assert.rejects(send({ ...options, timeoutMs: 5 }), /bounds/);
});
