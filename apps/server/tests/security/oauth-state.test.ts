import { GoogleOAuthService } from '../../src/services/GoogleOAuthService';

/**
 * OAuth state is the only identity signal on the unauthenticated Google
 * callbacks. It must be signed: otherwise a caller can forge any userId or
 * swap the state on a callback URL (account-linking CSRF).
 */

const stateFromUrl = (url: string) => new URL(url).searchParams.get('state') as string;

describe('GoogleOAuthService state signing', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-key-for-testing-purposes-only';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  it('round-trips the user id, service and extra fields', () => {
    const url = GoogleOAuthService.generateAuthUrl(
      'https://api.example.com/api/gmail/auth/callback',
      [],
      7,
      'gmail',
      { name: 'Work mailbox' }
    );

    expect(GoogleOAuthService.parseState(stateFromUrl(url))).toEqual(
      expect.objectContaining({ userId: 7, service: 'gmail', name: 'Work mailbox' })
    );
  });

  it('rejects an unsigned state (the old format)', () => {
    const unsigned = Buffer.from(JSON.stringify({ userId: 2, service: 'gmail' })).toString(
      'base64url'
    );

    expect(() => GoogleOAuthService.parseState(unsigned)).toThrow();
  });

  it('rejects a tampered payload', () => {
    const url = GoogleOAuthService.generateAuthUrl('https://example.com/cb', [], 1, 'sheets');
    const state = stateFromUrl(url);
    const [payload, signature] = state.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const tampered = Buffer.from(JSON.stringify({ ...decoded, userId: 2 })).toString('base64url');

    expect(() => GoogleOAuthService.parseState(`${tampered}.${signature}`)).toThrow();
  });
});
