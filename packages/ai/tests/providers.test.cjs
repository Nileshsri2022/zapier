const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callProvider, chatBody } = require('../dist/providers');
const request = {
  provider: 'openai',
  model: 'test-model',
  apiKey: 'NEVER_LEAK',
  system: 'system',
  input: '<input>data</input>',
  schema: { type: 'object' },
  temperature: 0,
  maxOutputTokens: 500,
  timeoutMs: 100,
  maxResponseBytes: 1048576,
  allowedHosts: ['api.example.com'],
};
function fakeFetch(t, handler) {
  const old = global.fetch;
  global.fetch = handler;
  t.after(() => {
    global.fetch = old;
  });
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

test('OpenAI uses strict JSON Schema, bounded parameters and normalized usage', async (t) => {
  fakeFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.max_tokens, 500);
    assert.equal(options.headers.Authorization, 'Bearer NEVER_LEAK');
    return json({
      choices: [{ message: { content: '{"x":1}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });
  });
  assert.deepEqual(await callProvider(request), {
    text: '{"x":1}',
    usage: { inputTokens: 10, outputTokens: 4 },
  });
});

test('Anthropic forced tool parsing; plain text does not satisfy a structured response', async (t) => {
  fakeFetch(t, async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice.name, 'emit_output');
    assert.equal(options.headers['x-api-key'], 'NEVER_LEAK');
    return json({
      content: [{ type: 'tool_use', name: 'emit_output', input: { category: 'negative' } }],
      usage: { input_tokens: 5, output_tokens: 2 },
    });
  });
  const output = await callProvider({ ...request, provider: 'anthropic' });
  assert.deepEqual(output.structured, { category: 'negative' });
  assert.equal(output.usage.inputTokens, 5);
  global.fetch = async () => json({ content: [{ type: 'text', text: 'not a tool' }] });
  assert.equal((await callProvider({ ...request, provider: 'anthropic' })).structured, undefined);
});

test('compatible profiles choose a single known format, never probe/fallback on error', async () => {
  for (const [profile, expected] of [
    ['chat_json_schema', 'json_schema'],
    ['chat_json_object', 'json_object'],
    ['chat_prompt_json', undefined],
  ]) {
    let calls = 0;
    const req = {
      ...request,
      provider: 'openai_compatible',
      connection: {
        baseUrl: 'https://api.example.com/v1',
        apiKey: request.apiKey,
        capabilityProfileId: profile,
      },
    };
    assert.equal(chatBody(req).response_format?.type, expected);
    const output = await callProvider(req, async (options) => {
      calls++;
      assert.equal(options.baseUrl, req.connection.baseUrl);
      return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) };
    });
    assert.equal(output.text, 'ok');
    assert.equal(calls, 1);
    await assert.rejects(
      callProvider(req, async () => ({ status: 400, body: 'NEVER_LEAK' })),
      (e) => !e.retryable && !e.message.includes('NEVER_LEAK')
    );
  }
});

test('HTTP fatal/transient classification is based on status, never raw error body', async (t) => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    fakeFetch(t, async () => new Response('NEVER_LEAK', { status }));
    await assert.rejects(
      callProvider(request),
      (e) => e.retryable === (status === 429 || status >= 500) && !e.message.includes('NEVER_LEAK')
    );
  }
});

test('timeout aborts fetch and transient network errors are sanitized', async (t) => {
  fakeFetch(
    t,
    async (_url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('AbortError NEVER_LEAK')));
      })
  );
  await assert.rejects(
    callProvider({ ...request, timeoutMs: 5 }),
    (e) => e.retryable && !e.message.includes('NEVER_LEAK')
  );
});

test('response cap, refusal and truncation fail without output success', async (t) => {
  fakeFetch(t, async () => new Response('x'.repeat(100)));
  await assert.rejects(
    callProvider({ ...request, maxResponseBytes: 10 }),
    (e) => !e.retryable && /size limit/.test(e.message)
  );
  global.fetch = async () =>
    json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] });
  await assert.rejects(callProvider(request), (e) => !e.retryable);
  global.fetch = async () => json({ choices: [{ message: { refusal: 'not allowed' } }] });
  await assert.rejects(callProvider(request), (e) => !e.retryable);
});
