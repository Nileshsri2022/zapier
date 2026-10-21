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
      throw new AiStepError(
        'AI step input resolved to empty text; check the input template',
        false,
        undefined,
        'validation'
      );
    // Q-AI-04: over-limit input fails validation BEFORE the provider call — never truncated.
    if (resolvedInput.length > policy.maxInputChars)
      throw new AiStepError(
        `AI step input exceeds the ${policy.maxInputChars}-character limit`,
        false,
        undefined,
        'validation'
      );
    const input = resolvedInput;
    if (config.maxOutputTokens > policy.maxOutputTokens)
      throw new AiStepError('AI output token setting exceeds the configured limit', false, undefined, 'config');
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
    if (!/^[!-~]+$/.test(apiKey) || apiKey.length > 8192)
      throw new AiStepError('AI provider credential is invalid');
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
        // Q-AI-05: exactly one repair dispatch; a provider failure during repair keeps
        // its own class (never re-classified as malformed), and a failed repair is final.
        let phase: 'invoke' | 'validate' = 'invoke';
        try {
          result = await invoke();
          phase = 'validate';
          fields = validate(result);
        } catch (error) {
          const safe = safeAiError(error);
          if (phase === 'invoke')
            throw new AiStepError(
              `AI output repair failed: ${safe.message}`,
              false,
              safe.status,
              safe.code
            );
          const raw = (
            typeof result.text === 'string' && result.text.trim()
              ? result.text
              : JSON.stringify(result.structured ?? '')
          )
            .replace(/\s+/g, ' ')
            .slice(0, 200);
          throw new AiStepError(
            `AI output repair failed (${safe.message}); raw output: ${raw || '(empty)'}`,
            false,
            safe.status,
            'malformed_output'
          );
        }
      }
    } else {
      if (typeof result.text !== 'string' || !result.text.trim())
        throw new AiStepError(
          'AI provider returned empty text',
          false,
          undefined,
          'malformed_output'
        );
      if (config.mode === 'summarize') fields = { summary: result.text };
      else if (config.mode === 'generate' || config.mode === 'translate')
        fields = { text: result.text };
    }
    // Spec §4 contract (Q-AI-03): result.* first-class (classify mirrors label),
    // resultText always the raw model text, usage surfaced with prompt/completion names.
    const contractResult: AiStepOutput['result'] =
      config.mode === 'classify' && typeof fields.category === 'string'
        ? { ...fields, label: fields.category }
        : fields;
    const resultText =
      typeof result.text === 'string' && result.text
        ? result.text
        : result.structured !== undefined
          ? JSON.stringify(result.structured)
          : JSON.stringify(fields);
    return {
      ok: true,
      error: null,
      result: contractResult,
      resultText,
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
      usage: {
        promptTokens: state.usage.inputTokens ?? 0,
        completionTokens: state.usage.outputTokens ?? 0,
        ...(state.usage.inputTokens !== undefined
          ? { inputTokens: state.usage.inputTokens }
          : {}),
        ...(state.usage.outputTokens !== undefined
          ? { outputTokens: state.usage.outputTokens }
          : {}),
      },
      // Spec: flag when OUTPUT hits the max-tokens limit (Q-AI-04/§5).
      truncated: Boolean(result.truncated),
      latencyMs: Date.now() - state.startedAt,
    };
  } catch (error) {
    throw safeAiError(error);
  }
}
