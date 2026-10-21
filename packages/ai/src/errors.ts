import { AiConnectionError } from '@repo/ai-connections';

/** Spec §5 error classes (A1): failures are classified, not generic strings. */
export type AiErrorCode =
  | 'validation'
  | 'config'
  | 'malformed_output'
  | 'policy_refusal'
  | 'timeout'
  | 'provider_unavailable';

export class AiStepError extends Error {
  constructor(
    message: string,
    public readonly retryable = false,
    public readonly status?: number,
    public readonly code?: AiErrorCode
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
