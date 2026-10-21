/**
 * #38 — a refreshed Gmail access token used to be written back with
 * `updateMany({ where: { clientId } })`. `clientId` is the OAuth *app* id and is
 * the same string for every tenant, so one mailbox's refresh overwrote every
 * other mailbox's access token: the next request by any other user then
 * authenticated as the wrong account.
 *
 * The service must scope the write to its own `GmailServer` row, and must not
 * write at all when it was built without a server id.
 */

const refreshAccessToken = jest.fn();

jest.mock('googleapis', () => {
  class OAuth2 {
    public credentials: any = {};
    public _clientId = 'shared-app-client-id';
    constructor(_id?: string, _secret?: string) {}
    setCredentials(credentials: any) {
      this.credentials = { ...this.credentials, ...credentials };
    }
    refreshAccessToken() {
      return refreshAccessToken();
    }
  }
  return {
    google: {
      auth: { OAuth2 },
      // The Gmail surface is never touched by these tests.
      gmail: () => ({ users: {}, watch: jest.fn() }),
    },
    gmail_v1: {},
  };
});

const updateMany = jest.fn();
jest.mock('@repo/db', () => ({
  __esModule: true,
  default: { gmailServer: { updateMany: (...args: any[]) => updateMany(...args) } },
}));

import { GmailService } from '../../src/services/GmailService';

const HOUR = 60 * 60 * 1000;
const now = Date.now();

const build = (serverId?: string, tokenExpiry = new Date(now - HOUR)) =>
  new GmailService({
    serverId,
    clientId: 'shared-app-client-id',
    clientSecret: 'app-secret',
    refreshToken: 'refresh-token-of-this-mailbox',
    accessToken: 'stale-token',
    tokenExpiry,
  });

// `ensureValidToken` is private; the refresh path is what needs coverage.
const ensureValidToken = (service: GmailService) => (service as any).ensureValidToken();

beforeEach(() => {
  updateMany.mockReset();
  refreshAccessToken.mockReset();
  refreshAccessToken.mockResolvedValue({
    credentials: {
      access_token: 'fresh-token',
      expiry_date: now + HOUR,
    },
  });
});

describe('GmailService.ensureValidToken token write-back', () => {
  it('writes the refreshed token to its own server row, never by clientId', async () => {
    await ensureValidToken(build('server-1'));

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [args] = updateMany.mock.calls[0];
    expect(args.where).toEqual({ id: 'server-1' });
    expect(args.where.clientId).toBeUndefined();
    expect(args.data).toEqual({
      accessToken: 'fresh-token',
      tokenExpiry: new Date(now + HOUR),
    });
  });

  it('does not touch the database when it has no server id', async () => {
    await ensureValidToken(build(undefined));

    // Scoping by clientId is the platform-wide overwrite this issue is about;
    // with no id to scope by, the in-memory token is used and nothing is written.
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('does not refresh at all while the token is still valid', async () => {
    await ensureValidToken(build('server-1', new Date(now + HOUR)));

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('writes nothing when the provider returns no expiry', async () => {
    refreshAccessToken.mockResolvedValueOnce({ credentials: { access_token: 'fresh-token' } });

    await ensureValidToken(build('server-1'));

    expect(updateMany).not.toHaveBeenCalled();
  });
});
