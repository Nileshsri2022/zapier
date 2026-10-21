import {
  AiStepError,
  runAiStep,
  validateAiConfig,
  AiExecutionContext,
} from '@repo/ai';
// parseChatResponse lives in providers (not re-exported at the package root).
import { callProvider, parseChatResponse } from '../../../packages/ai/src/providers';

const env = {
  OPENAI_API_KEY: 'private-test-key',
  AI_DEFAULT_MODEL_OPENAI: 'test-model',
  AI_MODEL_ALLOWLIST_OPENAI: 'test-model',
};

function ctx(): { execution: AiExecutionContext; reserveCall: jest.Mock } {
  const reserveCall = jest.fn(async () => {});
  return { execution: { userId: 7, env, reserveCall }, reserveCall };
}

const okProvider = (text: string, usage?: { inputTokens: number; outputTokens: number }) =>
  jest.fn(async () => ({ text, usage }));

/**
 * A1 spec acceptance (docs/ask-matt/actions/ai-transform.md):
 * Q-AI-01 six operations · Q-AI-03 result.* contract · Q-AI-04 50k/30s/usage ·
 * Q-AI-05 repair-once → malformed_output · §5 error classes.
 */

describe('Q-AI-01: all six operations run with the §4 contract', () => {
  it('O1 classify → result.label ∈ categories (contract fields present)', async () => {
    const { execution } = ctx();
    const config = {
      provider: 'openai',
      mode: 'classify',
      input: '{text}',
      categories: ['urgent', 'normal', 'spam'],
    };
    const out = await runAiStep(
      config,
      'Fix this ASAP',
      execution,
      okProvider('{"category":"urgent"}', { inputTokens: 12, outputTokens: 3 })
    );
    expect(out.result.label).toBe('urgent');
    expect(['urgent', 'normal', 'spam']).toContain(out.result.label);
    expect(out.result.category).toBe('urgent'); // legacy alias kept
    expect(out.output).toBe('urgent');
    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(out.resultText).toBe('{"category":"urgent"}');
    expect(out.usage).toMatchObject({
      promptTokens: 12,
      completionTokens: 3,
      inputTokens: 12,
      outputTokens: 3,
    });
    expect(out.model).toBe('test-model');
    expect(typeof out.latencyMs).toBe('number');
    expect(out.truncated).toBe(false);
  });

  it('O2 extract → result.* strictly matches with number coercion', async () => {
    const { execution } = ctx();
    const config = {
      provider: 'openai',
      mode: 'extract',
      input: '{text}',
      outputFields: [
        { name: 'email', type: 'text', isRequired: true },
        { name: 'amount', type: 'number', isRequired: true },
      ],
    };
    const out = await runAiStep(
      config,
      'Ada, ada@example.com, paid $12',
      execution,
      okProvider('{"email":"ada@example.com","amount":"12"}')
    );
    expect(out.result).toEqual({ email: 'ada@example.com', amount: 12 });
    expect(out.resultText).toContain('ada@example.com');
    // usage always surfaced on success, even when the provider reports none
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it('O3 generate and O4 summarize return resultText output', async () => {
    const { execution } = ctx();
    const gen = await runAiStep(
      { provider: 'openai', mode: 'generate', input: '{text}', instructions: 'Rewrite politely' },
      'call me maybe',
      execution,
      okProvider('How may I assist you?')
    );
    expect(gen.result).toEqual({ text: 'How may I assist you?' });
    expect(gen.resultText).toBe('How may I assist you?');
    expect(gen.output).toBe('How may I assist you?');
    expect(gen.ok).toBe(true);

    const sum = await runAiStep(
      { provider: 'openai', mode: 'summarize', input: '{text}' },
      'very long text',
      execution,
      okProvider('short version')
    );
    expect(sum.result).toEqual({ summary: 'short version' });
    expect(sum.mode).toBe('summarize');
  });

  it('O5 custom prompt requires instructions; O6 translate returns translation', async () => {
    const { execution } = ctx();
    expect(() => validateAiConfig({ provider: 'openai', mode: 'custom', input: 'x' })).toThrow();

    const out = await runAiStep(
      {
        provider: 'openai',
        mode: 'translate',
        input: '{text}',
        instructions: 'Translate to Hindi',
      },
      'Good morning',
      execution,
      okProvider('सुप्रभात')
    );
    expect(out.resultText).toBe('सुप्रभात');
    expect(out.result).toEqual({ text: 'सुप्रभात' });
    expect(out.mode).toBe('translate');
  });
});

describe('Q-AI-05 malformed output: repair once, then fail classified', () => {
  it('fails with code malformed_output and a raw snippet after ONE repair', async () => {
    const { execution } = ctx();
    const provider = jest.fn(async () => ({ text: 'definitely not json {{' }));
    const promise = runAiStep(
      { provider: 'openai', mode: 'extract', input: '{text}', outputFields: [{ name: 'name', type: 'text', isRequired: true }] },
      'input',
      execution,
      provider
    );
    await expect(promise).rejects.toMatchObject({ code: 'malformed_output' });
    await promise.catch((error: AiStepError) => {
      expect(error.message).toContain('definitely not json');
      expect(error.retryable).toBe(false);
    });
    expect(provider).toHaveBeenCalledTimes(2); // original + exactly one repair
  });

  it('classify with an off-list label fails malformed after repair (never wrong-label success)', async () => {
    const { execution } = ctx();
    const provider = jest.fn(async () => ({ text: '{"category":"not-in-list"}' }));
    await expect(
      runAiStep(
        { provider: 'openai', mode: 'classify', input: '{text}', categories: ['a', 'b'] },
        'input',
        execution,
        provider
      )
    ).rejects.toMatchObject({ code: 'malformed_output' });
    expect(provider).toHaveBeenCalledTimes(2);
  });
});

describe('Q-AI-04 pre-call validation: no provider call', () => {
  it('empty/whitespace input → validation error, zero provider calls', async () => {
    const { execution } = ctx();
    const provider = okProvider('unused');
    await expect(
      runAiStep(
        { provider: 'openai', mode: 'summarize', input: '{text}' },
        '   \n\t  ',
        execution,
        provider
      )
    ).rejects.toMatchObject({ code: 'validation' });
    expect(provider).not.toHaveBeenCalled();
  });

  it('input over 50,000 chars → validation error, zero provider calls, no truncation', async () => {
    const { execution } = ctx();
    const provider = okProvider('unused');
    await expect(
      runAiStep(
        { provider: 'openai', mode: 'summarize', input: '{text}' },
        'x'.repeat(50_001),
        execution,
        provider
      )
    ).rejects.toMatchObject({ code: 'validation' });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe('§5 error classes and bounded retry inputs', () => {
  it('provider refusal classifies as policy_refusal (non-retryable)', async () => {
    const { execution } = ctx();
    const provider = jest.fn(async () => {
      throw new AiStepError('AI provider refused to process this content', false, undefined, 'policy_refusal');
    });
    await expect(
      runAiStep({ provider: 'openai', mode: 'summarize', input: '{text}' }, 'x', execution, provider)
    ).rejects.toMatchObject({ code: 'policy_refusal', retryable: false });
  });

  it('transient 429 stays retryable with status (worker backoff input)', async () => {
    const { execution } = ctx();
    const provider = jest.fn(async () => {
      throw new AiStepError('AI provider request failed (HTTP 429)', true, 429);
    });
    await expect(
      runAiStep({ provider: 'openai', mode: 'summarize', input: '{text}' }, 'x', execution, provider)
    ).rejects.toMatchObject({ retryable: true, status: 429 });
  });

  it('output truncated flag set when the provider stops at max-tokens', async () => {
    const { execution } = ctx();
    const out = await runAiStep(
      { provider: 'openai', mode: 'summarize', input: '{text}' },
      'x',
      execution,
      jest.fn(async () => ({ text: 'partial answer', truncated: true }))
    );
    expect(out.truncated).toBe(true);
    expect(out.ok).toBe(true); // truncation is a flag, not an error
  });
});

describe('provider classification mapping (parseChatResponse / callProvider)', () => {
  it('refusal and content_filter → policy_refusal; length → truncated flag', () => {
    expect(() =>
      parseChatResponse({ choices: [{ message: { content: '', refusal: 'nope' } }] })
    ).toThrow(expect.objectContaining({ code: 'policy_refusal' }));
    expect(() =>
      parseChatResponse({ choices: [{ message: {}, finish_reason: 'content_filter' }] })
    ).toThrow(expect.objectContaining({ code: 'policy_refusal' }));
    const length = parseChatResponse({
      choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
    });
    expect(length.truncated).toBe(true);
    expect(length.text).toBe('partial');
    expect(() =>
      parseChatResponse({ choices: [{ message: {}, finish_reason: 'tool_calls' }] })
    ).toThrow('unsupported tool-call');
  });

  it('fetch abort → timeout class (retryable); HTTP 429 → provider error with status', async () => {
    const originalFetch = global.fetch;
    const request = {
      provider: 'openai' as const,
      model: 'test-model',
      apiKey: 'k',
      system: 's',
      input: 'i',
      temperature: 0,
      maxOutputTokens: 16,
      timeoutMs: 5,
      maxResponseBytes: 1000,
      allowedHosts: [] as readonly string[],
    };
    try {
      global.fetch = jest.fn(async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }) as unknown as typeof fetch;
      await expect(callProvider(request)).rejects.toMatchObject({
        code: 'timeout',
        retryable: true,
      });

      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 429,
        body: { cancel: async () => {} },
      })) as unknown as typeof fetch;
      await expect(callProvider(request)).rejects.toMatchObject({
        retryable: true,
        status: 429,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
