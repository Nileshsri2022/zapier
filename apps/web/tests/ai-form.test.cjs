const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const { act } = Renderer;
function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, relative);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (name) =>
    Object.hasOwn(overrides, name) ? overrides[name] : Module.prototype.require.call(mod, name);
  mod._compile(js, filename);
  return mod.exports;
}
const schemas = load('../../../packages/types/src/ai.ts');
const saved = {
  id: '47116642-58b9-4b97-aa21-f92454711ff3',
  name: 'My service',
  baseUrl: 'https://api.example.com/v1',
  capabilityProfileId: 'chat_json_schema',
  configured: true,
  revoked: false,
};
const discovery = {
  defaultProvider: 'openai',
  limits: { maxInputChars: 20000, maxOutputTokens: 2000 },
  providers: [
    { id: 'openai', configured: true, models: ['test-model'], defaultModel: 'test-model' },
    { id: 'anthropic', configured: true, models: ['claude-test'], defaultModel: 'claude-test' },
    { id: 'puter', configured: false, models: [], defaultModel: '' },
    {
      id: 'openai_compatible',
      configured: true,
      models: [],
      defaultModel: '',
      connectionRequired: true,
    },
  ],
};
async function fixture(t) {
  const calls = [];
  const results = [];
  const client = {
    aiRequest: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith('/models')) return discovery;
      if (url === '/api/ai/connections' && !init) return { connections: [saved] };
      if (url === '/api/ai/connections' && init?.method === 'POST') return { connection: saved };
      if (url.endsWith('/test'))
        return {
          output: 'Summary',
          fields: { summary: 'Summary' },
          provider: 'openai',
          model: 'test-model',
          latencyMs: 12,
        };
      if (init?.method === 'DELETE') return { affectedZapCount: 2 };
      if (init?.method === 'PATCH') return { connection: saved };
      throw Error('Unexpected request');
    },
  };
  const Component = load('../components/metadata/AiMetaData.tsx', {
    '@/lib/ai': client,
    '@repo/types': schemas,
  }).default;
  let view;
  await act(async () => {
    view = Renderer.create(
      React.createElement(Component, { handleClick: (data) => results.push(data) })
    );
  });
  t.after(() => {
    act(() => view.unmount());
  });
  const change = (id, value) =>
    act(() => view.root.findByProps({ id }).props.onChange({ target: { value, checked: value } }));
  const button = (label) =>
    view.root.findAllByType('button').find((node) => node.children.join('') === label);
  const click = async (label) => {
    const target = button(label);
    assert.ok(target, label);
    await act(async () => target.props.onClick());
  };
  return { view, results, calls, change, click, button };
}

test('four provider choices, disabled unavailable provider, classifier saves metadata', async (t) => {
  const f = await fixture(t);
  const options = f.view.root.findByProps({ id: 'ai-provider' }).findAllByType('option');
  assert.equal(options.length, 4);
  assert.equal(options.find((o) => o.props.value === 'puter').props.disabled, true);
  f.change('ai-mode', 'classify');
  f.change('ai-input', '{message}');
  await f.click('Save AI step');
  assert.equal(f.results[0].mode, 'classify');
  assert.deepEqual(f.results[0].categories, ['positive', 'neutral', 'negative']);
});

test('extract fields and custom instructions validate before save', async (t) => {
  const f = await fixture(t);
  f.change('ai-mode', 'extract');
  f.change('ai-field-0', 'orderId');
  await f.click('Save AI step');
  assert.equal(f.results[0].outputFields[0].name, 'orderId');
  f.change('ai-mode', 'custom');
  await f.click('Save AI step');
  assert.equal(f.results.length, 1);
  assert.ok(f.view.root.findAllByProps({ role: 'alert' }).length);
  f.change('ai-instructions', 'Rewrite in Hindi');
  await f.click('Save AI step');
  assert.equal(f.results[1].instructions, 'Rewrite in Hindi');
});

test('test panel sends literal sample and renders parsed result with unavailable usage', async (t) => {
  const f = await fixture(t);
  f.change('ai-sample', 'Literal {placeholder}');
  await f.click('Test step (billable)');
  const call = f.calls.find((c) => c.url.endsWith('/test'));
  assert.equal(JSON.parse(call.init.body).input, 'Literal {placeholder}');
  assert.equal(f.results.length, 0);
  const rendered = JSON.stringify(f.view.toJSON());
  assert.match(rendered, /Parsed result/);
  assert.match(rendered, /not reported/);
});

test('connection credentials are write-only, cleared after save, and absent from action metadata', async (t) => {
  const f = await fixture(t);
  f.change('ai-provider', 'openai_compatible');
  f.change('ai-model', 'byok-model');
  await f.click('+ New connection');
  f.change('ai-connection-name', 'My service');
  f.change('ai-base-url', saved.baseUrl);
  f.change('ai-api-key', 'PRIVATE_KEY');
  assert.equal(f.view.root.findByProps({ id: 'ai-api-key' }).props.type, 'password');
  await f.click('Save connection');
  assert.equal(f.view.root.findAllByProps({ id: 'ai-api-key' }).length, 0);
  const sent = f.calls.find((c) => c.init?.method === 'POST' && c.url === '/api/ai/connections');
  assert.equal(JSON.parse(sent.init.body).apiKey, 'PRIVATE_KEY');
  await f.click('Save AI step');
  assert.equal(f.results[0].connectionId, saved.id);
  assert.ok(!JSON.stringify(f.results).includes('PRIVATE_KEY'));
  await f.click('Edit / replace key');
  assert.equal(f.view.root.findByProps({ id: 'ai-api-key' }).props.value, '');
  await f.click('Cancel');
});

test('AI API client uses fresh CSRF and credentialed fetch without paid-call retry', async (t) => {
  const old = global.fetch;
  const calls = [];
  t.after(() => {
    global.fetch = old;
  });
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/csrf')) return new Response(JSON.stringify({ csrfToken: 'csrf-value' }));
    return new Response(JSON.stringify({ message: 'Daily AI call budget reached' }), {
      status: 400,
    });
  };
  const { aiRequest } = load('../lib/ai.ts', { './config': { API_URL: '' } });
  await assert.rejects(
    aiRequest('/api/actions/ai/test', { method: 'POST', body: '{}' }),
    /budget reached/
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(calls[1].options.headers.get('X-AI-CSRF'), 'csrf-value');
  assert.ok(!calls[1].url.includes('localhost'));
});
