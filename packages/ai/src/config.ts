import { parseAllowedHosts } from '@repo/ai-connections';
import { AiConfig, AiMode, AiProvider, OutputField } from './types';
import { AiStepError } from './errors';
const fail = (): never => {
  throw new AiStepError('Invalid AI action configuration');
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function text(v: unknown, max: number, required = true): string {
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) return fail();
  return v;
}
function choices(v: unknown, min: number, max: number, maxLength: number): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return fail();
  const values = v.map((item) => text(item, maxLength).trim());
  if (new Set(values).size !== values.length) return fail();
  return values;
}
export function validateAiConfig(raw: unknown): AiConfig {
  if (!object(raw)) return fail();
  const provider = raw.provider as AiProvider;
  const mode = raw.mode as AiMode;
  if (
    !['openai', 'anthropic', 'puter', 'openai_compatible'].includes(provider) ||
    !['summarize', 'classify', 'extract', 'generate', 'translate', 'custom'].includes(mode)
  )
    return fail();
  const instructions =
    raw.instructions === undefined ? '' : text(raw.instructions, 4000, mode === 'custom');
  if (mode === 'custom' && !instructions.trim()) return fail();
  const temperature = raw.temperature ?? 0;
  const maxOutputTokens = raw.maxOutputTokens ?? 500;
  if (
    typeof temperature !== 'number' ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 1 ||
    typeof maxOutputTokens !== 'number' ||
    !Number.isInteger(maxOutputTokens) ||
    maxOutputTokens < 16 ||
    maxOutputTokens > 2000
  )
    return fail();
  const config: AiConfig = {
    provider,
    mode,
    instructions,
    input: text(raw.input, 4000),
    temperature,
    maxOutputTokens,
  };
  if (raw.model !== undefined && raw.model !== '') config.model = text(raw.model, 200);
  if (provider === 'openai_compatible') {
    config.connectionId = text(raw.connectionId, 100);
    if (!config.model) return fail();
  } else if (raw.connectionId !== undefined) return fail();
  if (mode === 'classify') config.categories = choices(raw.categories, 2, 20, 60);
  if (mode === 'extract' || (mode === 'custom' && raw.outputFields !== undefined)) {
    if (
      !Array.isArray(raw.outputFields) ||
      raw.outputFields.length > 25 ||
      (mode === 'extract' && !raw.outputFields.length)
    )
      return fail();
    config.outputFields = raw.outputFields.map((entry): OutputField => {
      if (!object(entry)) return fail();
      const name = text(entry.name, 50);
      if (
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) ||
        ['__proto__', 'prototype', 'constructor'].includes(name)
      )
        return fail();
      const type = entry.type as OutputField['type'];
      if (
        !['text', 'number', 'boolean', 'category_single', 'category_multi'].includes(type) ||
        typeof entry.isRequired !== 'boolean'
      )
        return fail();
      const field: OutputField = { name, type, isRequired: entry.isRequired };
      if (entry.description !== undefined) field.description = text(entry.description, 200, false);
      if (type.startsWith('category_')) field.options = choices(entry.options, 2, 50, 60);
      else if (entry.options !== undefined) return fail();
      return field;
    });
    if (new Set(config.outputFields.map((f) => f.name)).size !== config.outputFields.length)
      return fail();
  }
  return config;
}
export function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  max: number,
  min = 0
): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new AiStepError(`Invalid AI environment setting: ${name}`);
  }
  return value;
}
export function readAiPolicy(env: NodeJS.ProcessEnv = process.env) {
  if (env.AI_PUTER_ENABLED !== undefined && !['true', 'false'].includes(env.AI_PUTER_ENABLED))
    throw new AiStepError('Invalid AI_PUTER_ENABLED');
  if (env.AI_BUDGET_FAIL_OPEN !== undefined && !['true', 'false'].includes(env.AI_BUDGET_FAIL_OPEN))
    throw new AiStepError('Invalid AI_BUDGET_FAIL_OPEN');
  return {
    // Q-AI-04: input ≤ 50,000 chars (reject before the provider call, never
    // silently truncate) and provider timeout 30s.
    maxInputChars: integerEnv(env, 'AI_MAX_INPUT_CHARS', 50000, 50000, 1),
    maxOutputTokens: integerEnv(env, 'AI_MAX_OUTPUT_TOKENS', 2000, 2000, 16),
    timeoutMs: integerEnv(env, 'AI_TIMEOUT_MS', 30000, 30000, 1),
    maxResponseBytes: integerEnv(env, 'AI_MAX_RESPONSE_BYTES', 1048576, 1048576, 1),
    userCap: integerEnv(env, 'AI_DAILY_CALL_CAP_PER_USER', 200, 1000000),
    globalCap: integerEnv(env, 'AI_DAILY_CALL_CAP_GLOBAL', 0, 1000000000),
    failOpen: env.AI_BUDGET_FAIL_OPEN === 'true',
    puterEnabled: env.AI_PUTER_ENABLED === 'true',
    allowedHosts: parseAllowedHosts(env.AI_COMPATIBLE_ALLOWED_HOSTS),
  };
}
export function platformModel(config: AiConfig, env: NodeJS.ProcessEnv): string {
  const suffix = config.provider.toUpperCase();
  const model = config.model || env[`AI_DEFAULT_MODEL_${suffix}`];
  const allowlist = (env[`AI_MODEL_ALLOWLIST_${suffix}`] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!model || !allowlist.includes(model))
    throw new AiStepError(
      'AI model must be configured in the selected platform provider allowlist'
    );
  return model;
}
