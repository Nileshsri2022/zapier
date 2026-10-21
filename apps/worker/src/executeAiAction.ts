import {
  AiExecutionContext,
  AiStepError,
  AiStepOutput,
  createDailyBudget,
  createExecutionState,
  runAiStep,
  safeAiError,
  validateAiConfig,
} from '@repo/ai';
import { createAiConnectionService } from '@repo/ai-connections';
import client from '@repo/db';
import redis from '@repo/redis';
import { resolvePlaceholders } from '@repo/placeholders';
import { withRetry } from './utils/retry';

export interface AiActionContext {
  userId: number;
  zapRunId: string;
  stage: number;
}
export interface AiActionDependencies {
  run: typeof runAiStep;
  executionContext: (userId: number) => AiExecutionContext;
}
const defaults: AiActionDependencies = {
  run: runAiStep,
  executionContext: (userId) => ({
    userId,
    reserveCall: createDailyBudget((script, keys, args) => redis.eval(script, keys, args), userId),
    // Lazy: missing connection encryption settings must not break direct providers or replays.
    resolveConnection: (id, ownerId) => createAiConnectionService(client).resolve(id, ownerId),
  }),
};

/** Kept separate from the Kafka entrypoint so real worker integration can be tested without booting it. */
export async function executeAiAction(
  metadata: unknown,
  runMetadata: Record<string, unknown>,
  previousOutputs: Record<number, unknown> | undefined,
  context: AiActionContext | undefined,
  dependencies: AiActionDependencies = defaults
) {
  const state = createExecutionState();
  let execution: AiExecutionContext | undefined;
  return withRetry(
    async () => {
      try {
        if (
          !context ||
          !Number.isInteger(context.stage) ||
          context.stage < 1 ||
          !context.zapRunId ||
          !Number.isSafeInteger(context.userId) ||
          context.userId < 1
        )
          throw new AiStepError('AI action requires valid run, stage and owner context');
        if (previousOutputs && Object.hasOwn(previousOutputs, context.stage)) {
          return {
            success: true,
            message: 'AI step replay: reused stored output',
            output: previousOutputs[context.stage] as AiStepOutput,
          };
        }
        const config = validateAiConfig(metadata);
        execution ??= dependencies.executionContext(context.userId);
        const output = await dependencies.run(
          config,
          String(resolvePlaceholders(config.input, runMetadata)),
          {
            ...execution,
            state,
          }
        );
        return { success: true, message: `AI ${output.mode} via ${output.provider}`, output };
      } catch (error) {
        throw safeAiError(error);
      }
    },
    {
      maxRetries: 3,
      initialDelayMs: 1000,
      shouldRetry: (error) => error instanceof AiStepError && error.retryable,
    }
  );
}
