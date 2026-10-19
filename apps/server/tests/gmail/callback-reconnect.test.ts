import client from '@repo/db';

/**
 * Reconnecting the same mailbox must reuse the existing GmailServer row.
 * The callback previously always called create(), producing duplicate
 * servers/watches and duplicate runs for every inbound email.
 */

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        generateAuthUrl: jest.fn(
          (options: any) =>
            `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(
              options.state
            )}`
        ),
        getToken: jest.fn().mockResolvedValue({
          tokens: {
            refresh_token: 'new-refresh-token',
            access_token: 'new-access-token',
            expiry_date: Date.now() + 60 * 60 * 1000,
          },
        }),
      })),
    },
    gmail: jest.fn().mockImplementation(() => ({
      users: {
        getProfile: jest.fn().mockResolvedValue({
          data: { emailAddress: 'me@example.com', historyId: 'history-2' },
        }),
      },
    })),
    oauth2: jest.fn(),
    sheets: jest.fn(),
    calendar: jest.fn(),
  },
}));

jest.mock('../../src/services/GmailService', () => ({
  GmailService: jest.fn().mockImplementation(() => ({
    watchEmails: jest.fn().mockResolvedValue({
      watchId: 'watch-2',
      expiry: new Date('2026-10-26T00:00:00.000Z'),
    }),
    stopWatching: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { handleGmailCallback } from '../../src/controllers/GmailController';
import { GoogleOAuthService } from '../../src/services/GoogleOAuthService';

const callCallback = async () => {
  const redirect = jest.fn();
  const json = jest.fn();
  const res = { redirect, status: jest.fn().mockReturnValue({ json }), json };
  const authUrl = GoogleOAuthService.generateAuthUrl(
    'https://api.example.com/api/gmail/auth/callback',
    [],
    1,
    'gmail',
    { name: 'Again' }
  );
  const state = new URL(authUrl).searchParams.get('state') as string;
  await handleGmailCallback(
    {
      query: {
        code: 'auth-code',
        state,
      },
    } as any,
    res as any
  );
  return res;
};

describe('handleGmailCallback — reconnect', () => {
  const originalApiUrl = process.env.API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.API_URL = 'https://api.example.com';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
    (client.gmailServer.findFirst as jest.Mock).mockResolvedValue({
      id: 'server-1',
      userId: 1,
      name: 'Gmail',
      email: 'me@example.com',
      refreshToken: 'old-refresh-token',
      accessToken: 'old-access-token',
      tokenExpiry: new Date('2026-10-19T00:00:00.000Z'),
      isActive: true,
      lastHistoryId: 'history-1',
    });
    (client.gmailServer.create as jest.Mock).mockResolvedValue({ id: 'server-2' });
    (client.gmailServer.update as jest.Mock).mockResolvedValue({ id: 'server-1' });
    (client.gmailWatch.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (client.gmailWatch.create as jest.Mock).mockResolvedValue({ id: 'watch-2' });
  });

  afterEach(() => {
    process.env.API_URL = originalApiUrl;
  });

  it('updates the existing server instead of creating a duplicate', async () => {
    const response = await callCallback();
    const redirect = response.redirect;

    expect(client.gmailServer.create).not.toHaveBeenCalled();
    expect(client.gmailServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'server-1' },
        data: expect.objectContaining({ accessToken: 'new-access-token' }),
      })
    );
    expect(client.gmailWatch.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { serverId: 'server-1', isActive: true } })
    );
    expect(redirect).toHaveBeenCalledWith(expect.stringContaining('gmail=connected'));
  });
});
