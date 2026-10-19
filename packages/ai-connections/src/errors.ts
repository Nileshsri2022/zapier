/** Messages are safe for clients; never wrap a raw crypto, DNS or provider error. */
export class AiConnectionError extends Error {
  constructor(
    public readonly code:
      | 'CONFIGURATION'
      | 'INVALID_INPUT'
      | 'NOT_FOUND'
      | 'ENDPOINT_BLOCKED'
      | 'TRANSPORT',
    message: string
  ) {
    super(message);
    this.name = 'AiConnectionError';
  }
}
