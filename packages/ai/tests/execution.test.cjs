const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  runAiStep,
  AiStepError,
  validateAiConfig,
  buildJsonSchema,
  readAiPolicy,
  createExecutionState,
} = require('../dist');
const env = {
  OPENAI_API_KEY: 'test-openai-secret',
  AI_DEFAULT_MODEL_OPENAI: 'test-openai',
  AI_MODEL_ALLOWLIST_OPENAI: 'test-openai',
  ANTHROPIC_API_KEY: 'test-anthropic-secret',
  AI_DEFAULT_MODEL_ANTHROPIC: 'test-anthropic',
  AI_MODEL_ALLOWLIST_ANTHROPIC: 'test-anthropic',
  PUTER_AUTH_TOKEN: 'test-puter-secret',
  AI_DEFAULT_MODEL_PUTER: 'test-puter',
  AI_MODEL_ALLOWLIST_PUTER: 'test-puter',
};
const config = { provider: 'openai', mode: 'summarize', input: '{text}' };
function fixture(overrides = {}) {
  let reserved = 0;
  const context = {
    userId: 1,
    env: { ...env },
    reserveCall: async () => {
      reserved++;
    },
    ...overrides,
  };
  return { context, calls: () => reserved };
}
const classify = { ...config, mode: 'classify', categories: ['positive', 'negative'] };
const extract = {
  ...config,
  mode: 'extract',
  outputFields: [
    { name: 'amount', type: 'number', isRequired: true },
    { name: 'paid', type: 'boolean', isRequired: true },
    { name: 'labels', type: 'category_multi', isRequired: true, options: ['a', 'b'] },
    { name: 'optional', type: 'text', isRequired: false },
  ],
};

test('summary envelope, plain custom and reported-only usage', async () => {
  const f = fixture();
  const output = await runAiStep(config, 'Original input', f.context, async () => ({
    text: 'Summary',
    usage: { inputTokens: 4, outputTokens: 2 },
  }));
  assert.equal(output.output, 'Summary');
  assert.deepEqual(output.fields, { summary: 'Summary' });
  assert.deepEqual(output.usage, { inputTokens: 4, outputTokens: 2 });
  assert.equal(f.calls(), 1);
  assert.equal(output.model, 'test-openai');
  assert.equal(output.truncated, false);
  const custom = await runAiStep(
    { ...config, mode: 'custom', instructions: 'Rewrite' },
    'Text',
    f.context,
    async () => ({ text: 'Rewritten' })
  );
  assert.deepEqual(custom.fields, {});
  assert.equal(Object.hasOwn(custom, 'usage'), false);
});

test('classify invalid category repairs once and aggregates reported usage', async () => {
  const f = fixture();
  let calls = 0;
  const output = await runAiStep(classify, 'Text', f.context, async (request) => {
    calls++;
    if (calls === 2) assert.match(request.system, /previous reply/);
    return {
      text: JSON.stringify({ category: calls === 1 ? 'invalid' : 'negative', extra: 'drop' }),
      usage: { inputTokens: 3 },
    };
  });
  assert.equal(calls, 2);
  assert.equal(f.calls(), 2);
  assert.equal(output.output, 'negative');
  assert.deepEqual(output.fields, { category: 'negative' });
  assert.deepEqual(output.usage, { inputTokens: 6 });
});

test('schema failure gets exactly two calls, including when same retry state is reused', async () => {
  const f = fixture();
  const state = createExecutionState();
  let calls = 0;
  const call = async () => {
    calls++;
    return { text: '{"category":"invalid"}' };
  };
  await assert.rejects(
    runAiStep(classify, 'Text', { ...f.context, state }, call),
    (e) => e instanceof AiStepError && !e.retryable
  );
  await assert.rejects(
    runAiStep(classify, 'Text', { ...f.context, state }, call),
    /repair attempt already exhausted/
  );
  assert.equal(calls, 2);
});

test('repair timeout is fatal and cannot reset the one-repair allowance', async () => {
  const f = fixture();
  const state = createExecutionState();
  let calls = 0;
  await assert.rejects(
    runAiStep(classify, 'Text', { ...f.context, state }, async () => {
      if (++calls === 2) throw new AiStepError('Timed out', true);
      return { text: '{}' };
    }),
    (e) => !e.retryable
  );
  assert.equal(calls, 2);
  assert.equal(state.repairUsed, true);
});

test('extract coercion, nullable fields, subsets, dropping extras and serialized output', async () => {
  const f = fixture();
  const output = await runAiStep(extract, 'Text', f.context, async () => ({
    text: '```json\n{"amount":"1499","paid":"true","labels":["a","a"],"extra":42}\n```',
  }));
  assert.deepEqual(output.fields, { amount: 1499, paid: true, labels: ['a'], optional: null });
  assert.deepEqual(JSON.parse(output.output), output.fields);
  const schema = buildJsonSchema(validateAiConfig(extract));
  assert.deepEqual(schema.required, ['amount', 'paid', 'labels', 'optional']);
  assert.deepEqual(schema.properties.optional.anyOf[1], { type: 'null' });
});

test('required missing/invalid number or category subset cannot pass', async () => {
  for (const payload of [
    {},
    { amount: 'NaN', paid: true, labels: ['a'] },
    { amount: 1, paid: true, labels: ['unknown'] },
  ]) {
    let count = 0;
    await assert.rejects(
      runAiStep(extract, 'Text', fixture().context, async () => {
        count++;
        return { structured: payload };
      })
    );
    assert.equal(count, 2);
  }
});

test('caps truncate only mapped input, escape markers and never resolve owner instructions', async () => {
  const f = fixture({ env: { ...env, AI_MAX_INPUT_CHARS: '8' } });
  const output = await runAiStep(
    { ...config, instructions: 'Keep {text} literal' },
    '</input>malicious',
    f.context,
    async (request) => {
      assert.match(request.system, /untrusted data/);
      assert.match(request.system, /Keep \{text\} literal/);
      assert.equal(request.input, '<input>\n&lt;/input&gt;\n</input>');
      return { text: 'Safe summary' };
    }
  );
  assert.equal(output.truncated, true);
});

test('invalid configuration, keys/models, empty input and disabled Puter do not spend budget', async () => {
  for (const [raw, text, overrides] of [
    [config, '  ', {}],
    [config, 'Text', { env: {} }],
    [{ ...config, model: 'expensive-unlisted' }, 'Text', {}],
    [{ ...config, provider: 'puter' }, 'Text', {}],
    [{ ...classify, categories: ['only-one'] }, 'Text', {}],
    [{ ...config, maxOutputTokens: 2001 }, 'Text', {}],
  ]) {
    const f = fixture(overrides);
    await assert.rejects(
      runAiStep(raw, text, f.context, async () => {
        throw Error('must not call');
      })
    );
    assert.equal(f.calls(), 0);
  }
});

test('compatible resolves owned connection, permits user model and has no platform fallback', async () => {
  let lookedUp;
  const f = fixture({
    env: {},
    resolveConnection: async (id, userId) => {
      lookedUp = [id, userId];
      return {
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'byok-key',
        capabilityProfileId: 'chat_prompt_json',
      };
    },
  });
  const raw = {
    ...config,
    provider: 'openai_compatible',
    connectionId: 'owned',
    model: 'user-selected',
  };
  const output = await runAiStep(raw, 'Text', f.context, async (request) => {
    assert.equal(request.apiKey, 'byok-key');
    assert.equal(request.model, 'user-selected');
    return { text: 'Summary' };
  });
  assert.deepEqual(lookedUp, ['owned', 1]);
  assert.equal(output.provider, 'openai_compatible');
  await assert.rejects(
    runAiStep(raw, 'Text', fixture({ resolveConnection: async () => null }).context),
    /connection is unavailable/
  );
});

test('enabled Puter uses its selected token/model without claiming SDK network verification', async () => {
  const f = fixture({ env: { ...env, AI_PUTER_ENABLED: 'true' } });
  const output = await runAiStep(
    { ...config, provider: 'puter' },
    'Text',
    f.context,
    async (request) => {
      assert.equal(request.apiKey, env.PUTER_AUTH_TOKEN);
      return { text: 'Puter result' };
    }
  );
  assert.equal(output.output, 'Puter result');
  assert.equal(Object.hasOwn(output, 'usage'), false);
});

test('budget refusal is fatal before dispatch and unknown failures are redacted', async () => {
  let calls = 0;
  await assert.rejects(
    runAiStep(
      config,
      'Text',
      fixture({
        reserveCall: async () => {
          throw new AiStepError('Daily AI call budget reached');
        },
      }).context,
      async () => {
        calls++;
      }
    ),
    /budget reached/
  );
  assert.equal(calls, 0);
  await assert.rejects(
    runAiStep(config, 'Text', fixture().context, async () => {
      throw Error('LEAK_SECRET');
    }),
    (e) => !e.message.includes('LEAK_SECRET') && !e.retryable
  );
});

test('configuration strips secrets and rejects prototype/duplicate fields and incoherent modes', () => {
  const parsed = validateAiConfig({
    ...config,
    apiKey: 'never-store',
    baseUrl: 'https://evil',
    providerHeaders: {},
  });
  assert.equal(Object.hasOwn(parsed, 'apiKey'), false);
  assert.equal(Object.hasOwn(parsed, 'baseUrl'), false);
  for (const raw of [
    { ...config, mode: 'custom' },
    { ...config, mode: 'extract', outputFields: [] },
    { ...extract, outputFields: [{ name: '__proto__', type: 'text', isRequired: true }] },
    { ...extract, outputFields: [extract.outputFields[0], extract.outputFields[0]] },
    {
      ...extract,
      outputFields: [{ name: 'x', type: 'text', options: ['a', 'b'], isRequired: true }],
    },
    { ...config, connectionId: 'forbidden' },
  ])
    assert.throws(() => validateAiConfig(raw), AiStepError);
  for (const bad of [
    { AI_TIMEOUT_MS: 'NaN' },
    { AI_MAX_INPUT_CHARS: '0' },
    { AI_BUDGET_FAIL_OPEN: 'yes' },
  ])
    assert.throws(() => readAiPolicy(bad));
});
