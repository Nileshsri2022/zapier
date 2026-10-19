import { AiConnectionError } from '@repo/ai-connections';
export class AiStepError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AiStepError';
  }
}
export function safeAiError(error: unknown): AiStepError {
  if (error instanceof AiStepError) return error;
  if (error instanceof AiConnectionError) {
    return new AiStepError(error.message, error.code === 'TRANSPORT');
  }
  return new AiStepError('AI execution failed; check provider configuration');
}
export function providerHttpError(status: number): AiStepError {
  return new AiStepError(
    `AI provider request failed (HTTP ${status})`,
    status === 429 || status >= 500,
    status
  );
}
