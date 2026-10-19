import { AiStepError, safeAiError } from './errors';
import { platformModel, readAiPolicy, validateAiConfig } from './config';
import { buildJsonSchema, parseJsonText, validateAndCoerce } from './schema';
import { frameInput, systemPrompt } from './prompts';
import { callProvider } from './providers';
import {
  AiExecutionContext,
  AiStepOutput,
  ExecutionState,
  ProviderRequest,
  ProviderResult,
} from './types';
export * from './types';
export * from './config';
export * from './errors';
export * from './budget';
export * from './schema';

export function createExecutionState(): ExecutionState {
  return { repairUsed: false, startedAt: Date.now(), usage: {} };
}
export type ProviderCaller = (request: ProviderRequest) => Promise<ProviderResult>;

/** A single retry attempt; worker carries state across attempts so repair cannot reset itself. */
export async function runAiStep(
  raw: unknown,
  resolvedInput: string,
  context: AiExecutionContext,
  providerCall: ProviderCaller = callProvider
): Promise<AiStepOutput> {
  try {
    const config = validateAiConfig(raw);
    const env = context.env ?? process.env;
    const policy = readAiPolicy(env);
    if (
      !Number.isSafeInteger(context.userId) ||
      context.userId < 1 ||
      typeof context.reserveCall !== 'function'
    )
      throw new AiStepError('AI execution requires owner-scoped budget accounting');
    if (context.state?.repairUsed)
      throw new AiStepError('AI output repair attempt already exhausted');
    const state = context.state ?? createExecutionState();
    if (typeof resolvedInput !== 'string' || !resolvedInput.trim())
      throw new AiStepError('AI step input resolved to empty text; check the input template');
    const input = resolvedInput.slice(0, policy.maxInputChars);
    if (!input.trim())
      throw new AiStepError('AI step input resolved to empty text after truncation');
    if (config.maxOutputTokens > policy.maxOutputTokens)
      throw new AiStepError('AI output token setting exceeds the configured limit');
    if (config.provider === 'puter' && !policy.puterEnabled)
      throw new AiStepError('Puter is disabled pending provider verification');
    const connection =
      config.provider === 'openai_compatible'
        ? await context.resolveConnection?.(config.connectionId!, context.userId)
        : undefined;
    if (config.provider === 'openai_compatible' && !connection)
      throw new AiStepError('AI connection is unavailable');
    const keyName =
      config.provider === 'openai'
        ? 'OPENAI_API_KEY'
        : config.provider === 'anthropic'
          ? 'ANTHROPIC_API_KEY'
          : 'PUTER_AUTH_TOKEN';
    const apiKey = connection?.apiKey || env[keyName];
    if (!apiKey) throw new AiStepError(`AI action configured but ${keyName} is not set`);
    const model = connection ? config.model! : platformModel(config, env);
    const schema = buildJsonSchema(config);
    const request: ProviderRequest = {
      provider: config.provider,
      model,
      apiKey,
      connection,
      schema,
      system: systemPrompt(config, schema),
      input: frameInput(input),
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      timeoutMs: policy.timeoutMs,
      maxResponseBytes: policy.maxResponseBytes,
      allowedHosts: policy.allowedHosts,
    };
    const invoke = async () => {
      await context.reserveCall();
      const result = await providerCall(request);
      for (const key of ['inputTokens', 'outputTokens'] as const) {
        if (result.usage?.[key] !== undefined)
          state.usage[key] = (state.usage[key] ?? 0) + result.usage[key]!;
      }
      return result;
    };
    let result = await invoke();
    let fields: AiStepOutput['fields'] = {};
    if (schema) {
      const validate = (response: ProviderResult) =>
        validateAndCoerce(
          response.structured !== undefined
            ? response.structured
            : parseJsonText(response.text ?? ''),
          config
        );
      try {
        fields = validate(result);
      } catch {
        state.repairUsed = true;
        request.system +=
          '\nYour previous reply did not match the required format. Return only corrected JSON matching the schema, using the original input.';
        // Repair gets exactly one dispatch; do not re-bill it after an ambiguous timeout.
        try {
          result = await invoke();
          fields = validate(result);
        } catch (error) {
          const safe = safeAiError(error);
          throw new AiStepError(`AI output repair failed: ${safe.message}`, false, safe.status);
        }
      }
    } else {
      if (typeof result.text !== 'string' || !result.text.trim())
        throw new AiStepError('AI provider returned empty text');
      if (config.mode === 'summarize') fields = { summary: result.text };
    }
    return {
      output:
        config.mode === 'classify'
          ? String(fields.category)
          : schema
            ? JSON.stringify(fields)
            : result.text!,
      fields,
      provider: config.provider,
      model,
      mode: config.mode,
      ...(Object.keys(state.usage).length ? { usage: { ...state.usage } } : {}),
      truncated: resolvedInput.length > input.length,
      latencyMs: Date.now() - state.startedAt,
    };
  } catch (error) {
    throw safeAiError(error);
  }
}
