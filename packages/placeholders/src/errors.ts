/**
 * The typed refusal the resolver raises.
 *
 * The module deliberately knows nothing about `WebhookActionError`,
 * `EmailActionError` or `AiStepError`: each caller maps a `PlaceholderError`
 * into its own taxonomy (and therefore its own retry policy).
 */

export type PlaceholderErrorCode = 'INVALID_JSON';

export class PlaceholderError extends Error {
  readonly code: PlaceholderErrorCode;

  constructor(code: PlaceholderErrorCode, message: string) {
    super(message);
    this.name = 'PlaceholderError';
    this.code = code;
  }
}
