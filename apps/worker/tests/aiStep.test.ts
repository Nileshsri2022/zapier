import { AiStepError, runAiStep, AiExecutionContext } from '@repo/ai';
import { executeAiAction, AiActionDependencies } from '../src/executeAiAction';
import { withRetry } from '../src/utils/retry';

jest.mock('@repo/db', () => ({ __esModule: true, default: {} }));
jest.mock('@repo/redis', () => ({ __esModule: true, default: { eval: jest.fn() } }));
const context = { userId: 7, zapRunId: 'run-1', stage: 2 };
const config = { provider: 'openai', mode: 'summarize', input: '{previousOutput.fields.text}' };
const env = {
  OPENAI_API_KEY: 'private-test-key',
  AI_DEFAULT_MODEL_OPENAI: 'test-model',
  AI_MODEL_ALLOWLIST_OPENAI: 'test-model',
};
const output = {
  output: 'Summary',
  fields: { summary: 'Summary' },
  provider: 'openai' as const,
  model: 'test-model',
  mode: 'summarize' as const,
  truncated: false,
  latencyMs: 1,
};
let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  jest.useRealTimers();
});

function dependencies(call: Parameters<typeof runAiStep>[3]) {
  const reserveCall = jest.fn(async () => {});
  const executionContext = jest.fn(
    (userId: number): AiExecutionContext => ({ userId, env, reserveCall })
  );
  const run = jest.fn((raw, text, ctx) => runAiStep(raw, text, ctx, call)) as jest.MockedFunction<
    typeof runAiStep
  >;
  return { deps: { run, executionContext }, reserveCall, run, executionContext };
}

test('saved output replay needs no credentials, validation, context factory or provider calls', async () => {
  const deps: AiActionDependencies = {
    run: jest.fn(),
    executionContext: jest.fn(() => {
      throw Error('must not resolve');
    }),
  };
  const result = await executeAiAction(null, {}, { 2: output }, context, deps);
  expect(result.success).toBe(true);
  expect(result.data?.output).toBe(output);
  expect(deps.run).not.toHaveBeenCalled();
  expect(deps.executionContext).not.toHaveBeenCalled();
});

test('worker resolves previousOutput and stepOutputs only in input, not owner instructions', async () => {
  const calls = jest.fn(async () => ({ text: 'Summary' }));
  const f = dependencies(calls);
  const result = await executeAiAction(
    {
      ...config,
      instructions: 'Keep {text} literal',
      input: '{previousOutput.fields.text}/{stepOutputs.1.id}/{unknown}',
    },
    {
      previousOutput: { fields: { text: 'Resolved' } },
      stepOutputs: { 1: { id: 'step-one' } },
    },
    {},
    context,
    f.deps
  );
  expect(result.success).toBe(true);
  expect(f.run.mock.calls[0]?.[1]).toBe('Resolved/step-one/{unknown}');
  expect(f.run.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ instructions: 'Keep {text} literal' })
  );
  expect(f.reserveCall).toHaveBeenCalledTimes(1);
});

test('empty resolved input fails once before budget/provider; invalid context also fails once', async () => {
  const calls = jest.fn();
  const f = dependencies(calls);
  const result = await executeAiAction(
    config,
    { previousOutput: { fields: { text: '  ' } } },
    {},
    context,
    f.deps
  );
  expect(result.success).toBe(false);
  expect(result.attempts).toBe(1);
  expect(f.reserveCall).not.toHaveBeenCalled();
  expect(calls).not.toHaveBeenCalled();
  const missing = await executeAiAction(config, {}, {}, undefined, f.deps);
  expect(missing.success).toBe(false);
  expect(missing.attempts).toBe(1);
});

test('429 retries to success, 401 fails once and no raw errors leak', async () => {
  jest.useFakeTimers();
  const call = jest
    .fn()
    .mockRejectedValueOnce(new AiStepError('HTTP 429', true, 429))
    .mockResolvedValue({ text: 'Summary' });
  const f = dependencies(call);
  const pending = executeAiAction(
    config,
    { previousOutput: { fields: { text: 'Text' } } },
    {},
    context,
    f.deps
  );
  await jest.runAllTimersAsync();
  const result = await pending;
  expect(result.success).toBe(true);
  expect(result.attempts).toBe(2);
  expect(f.reserveCall).toHaveBeenCalledTimes(2);
  const fatal = dependencies(async () => {
    throw new AiStepError('HTTP 401', false, 401);
  });
  const failed = await executeAiAction(
    config,
    { previousOutput: { fields: { text: 'Text' } } },
    {},
    context,
    fatal.deps
  );
  expect(failed.success).toBe(false);
  expect(failed.attempts).toBe(1);
  expect(fatal.reserveCall).toHaveBeenCalledTimes(1);
});

test('repair limit and state survive a preceding transient retry, with no retry of a failed repair', async () => {
  jest.useFakeTimers();
  const call = jest
    .fn()
    .mockRejectedValueOnce(new AiStepError('HTTP 429', true))
    .mockResolvedValueOnce({ text: '{"category":"invalid"}' })
    .mockRejectedValueOnce(new AiStepError('Timeout', true));
  const f = dependencies(call);
  const pending = executeAiAction(
    { ...config, input: '{text}', mode: 'classify', categories: ['positive', 'negative'] },
    { text: 'Text' },
    {},
    context,
    f.deps
  );
  await jest.runAllTimersAsync();
  const result = await pending;
  expect(result.success).toBe(false);
  expect(result.attempts).toBe(2);
  expect(call).toHaveBeenCalledTimes(3);
  expect(f.reserveCall).toHaveBeenCalledTimes(3);
  expect(f.run.mock.calls[0]?.[2].state).toBe(f.run.mock.calls[1]?.[2].state);
});

test('retry utility preserves existing default behavior and supports opt-in fatal errors', async () => {
  const defaultCall = jest
    .fn()
    .mockRejectedValueOnce(Error('one'))
    .mockRejectedValueOnce(Error('two'))
    .mockResolvedValue('ok');
  const defaultResult = await withRetry(defaultCall, { initialDelayMs: 0 });
  expect(defaultResult.success).toBe(true);
  expect(defaultResult.attempts).toBe(3);
  const fatalCall = jest.fn(async () => {
    throw Error('fatal');
  });
  const fatalResult = await withRetry(fatalCall, { initialDelayMs: 0, shouldRetry: () => false });
  expect(fatalResult.attempts).toBe(1);
  expect(fatalCall).toHaveBeenCalledTimes(1);
});
