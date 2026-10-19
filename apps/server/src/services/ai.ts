import client from '@repo/db';
import redis from '@repo/redis';
import { AiActionMetaDataSchema, AiTestSchema } from '@repo/types';
import {
  AiStepError,
  createDailyBudget,
  platformModel,
  readAiPolicy,
  runAiStep,
  validateAiConfig,
} from '@repo/ai';
import { getAiConnectionService } from './aiConnections';

export class AiMetadataError extends Error {}
export async function validateAiMetadata(raw: unknown, userId: number) {
  const parsed = AiActionMetaDataSchema.safeParse(raw);
  if (!parsed.success)
    throw new AiMetadataError('Invalid AI metadata: check provider, mode, input and fields');
  const config = validateAiConfig(parsed.data);
  try {
    const policy = readAiPolicy();
    if (config.maxOutputTokens > policy.maxOutputTokens)
      throw new AiStepError('AI output token setting exceeds configured limit');
    if (config.provider === 'openai_compatible') {
      // No decryption/DNS needed at save time; worker revalidates policy and resolves at execution.
      const connection = await client.aiConnection.findFirst({
        where: { id: config.connectionId, userId, revokedAt: null, provider: 'openai_compatible' },
        select: { id: true },
      });
      if (!connection || !policy.allowedHosts.length)
        throw new AiStepError('AI connection is unavailable');
    } else {
      platformModel(config, process.env);
      if (config.provider === 'puter' && !policy.puterEnabled)
        throw new AiStepError('Puter is disabled pending provider verification');
      const key =
        config.provider === 'openai'
          ? 'OPENAI_API_KEY'
          : config.provider === 'anthropic'
            ? 'ANTHROPIC_API_KEY'
            : 'PUTER_AUTH_TOKEN';
      if (!process.env[key])
        throw new AiStepError(`Selected AI provider is not configured (${key})`);
    }
  } catch (error) {
    if (error instanceof AiStepError) throw new AiMetadataError(error.message);
    throw new AiMetadataError('AI connection or policy is unavailable');
  }
  return parsed.data;
}
export async function validateActionMetadata<
  T extends { availableActionId: string; actionMetaData?: unknown },
>(actions: T[], userId: number): Promise<T[]> {
  return Promise.all(
    actions.map(async (action) => {
      const catalog = await client.availableActions.findUnique({
        where: { id: action.availableActionId },
        select: { type: true },
      });
      if (!catalog) throw new AiMetadataError('Selected action is unavailable');
      return catalog.type === 'AI Transform'
        ? { ...action, actionMetaData: await validateAiMetadata(action.actionMetaData, userId) }
        : action;
    })
  );
}
export function aiModels() {
  const policy = readAiPolicy();
  const providers = (['openai', 'anthropic', 'puter'] as const).map((id) => {
    const suffix = id.toUpperCase();
    const models = [
      ...new Set(
        (process.env[`AI_MODEL_ALLOWLIST_${suffix}`] || '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
      ),
    ];
    const defaultModel = process.env[`AI_DEFAULT_MODEL_${suffix}`] || models[0] || '';
    const key =
      id === 'openai'
        ? 'OPENAI_API_KEY'
        : id === 'anthropic'
          ? 'ANTHROPIC_API_KEY'
          : 'PUTER_AUTH_TOKEN';
    const configured =
      Boolean(process.env[key]) &&
      models.length > 0 &&
      models.includes(defaultModel) &&
      (id !== 'puter' || policy.puterEnabled);
    return { id, models, defaultModel, configured, connectionRequired: false };
  });
  return {
    defaultProvider:
      providers.find((p) => p.id === process.env.AI_DEFAULT_PROVIDER && p.configured)?.id ||
      providers.find((p) => p.configured)?.id ||
      'openai_compatible',
    providers: [
      ...providers,
      {
        id: 'openai_compatible',
        models: [],
        defaultModel: '',
        configured: Boolean(
          policy.allowedHosts.length &&
          process.env.AI_CONNECTION_ENCRYPTION_KEYS &&
          process.env.AI_CONNECTION_ACTIVE_KEY_ID
        ),
        connectionRequired: true,
      },
    ],
    limits: { maxInputChars: policy.maxInputChars, maxOutputTokens: policy.maxOutputTokens },
  };
}
export async function previewAi(raw: unknown, userId: number) {
  const parsed = AiTestSchema.safeParse(raw);
  if (!parsed.success) throw new AiMetadataError('Invalid AI test configuration or sample input');
  const sample = parsed.data.input;
  const config = await validateAiMetadata({ ...parsed.data, input: 'literal sample' }, userId);
  return runAiStep(config, sample, {
    userId,
    reserveCall: createDailyBudget((script, keys, args) => redis.eval(script, keys, args), userId),
    resolveConnection: (id, owner) => getAiConnectionService().resolve(id, owner),
  });
}
