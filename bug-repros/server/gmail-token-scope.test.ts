/**
 * BUG: GmailService.ensureValidToken() writes the refreshed OAuth access token
 * with `gmailServer.updateMany({ where: { clientId } })`.
 *
 * Every GmailServer row stores the SAME platform OAuth client id
 * (`GmailController.handleGmailCallback` writes `clientId: process.env.GOOGLE_CLIENT_ID`
 * for every user), so that `where` matches EVERY connected mailbox in the
 * database: one user's token refresh overwrites every other tenant's
 * accessToken + tokenExpiry.
 *
 * Expected (green) behaviour: the write must be scoped to the single server row
 * the service was constructed for (by `id`, or `userId` + `email`).
 */

const refreshAccessToken = jest.fn();
const messagesGet = jest.fn();

jest.mock('googleapis', () => {
  class FakeOAuth2 {
    public credentials: any = {};
    public _clientId: string;
    constructor(clientId: string) {
      this._clientId = clientId;
    }
    setCredentials(creds: any) {
      this.credentials = creds;
    }
    async refreshAccessToken() {
      return refreshAccessToken();
    }
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      gmail: () => ({ users: { messages: { get: (...a: any[]) => messagesGet(...a) } } }),
    },
  };
});

import client from '@repo/db';
import { GmailService } from '../../apps/server/src/services/GmailService';

// The platform-wide OAuth client id: identical in every GmailServer row.
const PLATFORM_CLIENT_ID = 'shared-platform-client-id.apps.googleusercontent.com';

const updateMany = client.gmailServer.updateMany as unknown as jest.Mock;

const serviceFor = (refreshToken: string, accessToken: string) =>
  new GmailService({
    clientId: PLATFORM_CLIENT_ID,
    clientSecret: 'shared-platform-client-secret',
    refreshToken,
    accessToken,
    // Already expired => ensureValidToken() must refresh.
    tokenExpiry: new Date(Date.now() - 60_000),
  });

beforeEach(() => {
  jest.clearAllMocks();
  refreshAccessToken.mockResolvedValue({
    credentials: {
      access_token: 'ya29.fresh-token',
      expiry_date: Date.now() + 3_600_000,
      refresh_token: 'rt-unchanged',
    },
  });
  messagesGet.mockResolvedValue({
    data: {
      id: 'msg-1',
      threadId: 'thread-1',
      labelIds: ['INBOX'],
      payload: { headers: [{ name: 'From', value: 'a@b.com' }] },
    },
  });
  updateMany.mockResolvedValue({ count: 1 });
});

describe('GmailService token refresh scope', () => {
  it('scopes the refreshed-token write to the single server row it was built for', async () => {
    await serviceFor('refresh-token-user-1', 'stale-1').getEmailMetadata('msg-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    const where = updateMany.mock.calls[0][0].where;

    // A write keyed only on the shared platform clientId matches every tenant.
    expect(where).not.toEqual({ clientId: PLATFORM_CLIENT_ID });
    expect(where.id ?? where.userId ?? where.email).toBeDefined();
  });

  it("does not let user 2's refresh overwrite user 1's stored token", async () => {
    // Two tenants, two different mailboxes, one shared platform clientId.
    await serviceFor('refresh-token-user-1', 'stale-1').getEmailMetadata('msg-1');
    refreshAccessToken.mockResolvedValue({
      credentials: {
        access_token: 'ya29.user-2-token',
        expiry_date: Date.now() + 3_600_000,
      },
    });
    await serviceFor('refresh-token-user-2', 'stale-2').getEmailMetadata('msg-1');

    const writes = updateMany.mock.calls.map((c) => c[0]);
    // Each write must target exactly one row (count: 1) and be distinguishable.
    expect(new Set(writes.map((w) => JSON.stringify(w.where))).size).toBe(2);
    for (const write of writes) {
      expect(Object.keys(write.where).some((k) => k === 'clientId')).toBe(false);
    }
  });
});
