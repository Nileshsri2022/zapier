import request from 'supertest';
import express from 'express';
import client from '@repo/db';

jest.mock('../../src/services/GmailService', () => {
  return {
    GmailService: jest.fn().mockImplementation(() => ({
      stopWatching: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn((token: string) => {
      if (token === 'user-1-token') return { id: 1 };
      if (token === 'user-2-token') return { id: 2 };
      throw new Error('invalid token');
    }),
  },
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn((token: string) => {
    if (token === 'user-1-token') return { id: 1 };
    if (token === 'user-2-token') return { id: 2 };
    throw new Error('invalid token');
  }),
}));

import GmailRouter from '../../src/routes/GmailRoutes';

const app = express();
app.use(express.json());
app.use('/api/gmail', GmailRouter);

const oauthServer = {
  id: 'server-1',
  name: 'Owner mailbox',
  email: 'owner@example.com',
  clientId: 'google-client-id',
  clientSecret: 'super-secret-client-secret',
  refreshToken: 'super-secret-refresh-token',
  accessToken: 'super-secret-access-token',
  tokenExpiry: new Date('2026-10-20T00:00:00.000Z'),
  isActive: true,
  userId: 1,
  gmailTriggers: [],
  gmailActions: [],
  watchHistory: [],
};

describe('Gmail server API — credential exposure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([oauthServer]);
    (client.gmailServer.findFirst as jest.Mock).mockResolvedValue(oauthServer);
  });

  it('GET /api/gmail/servers does not return OAuth secrets', async () => {
    const response = await request(app)
      .get('/api/gmail/servers')
      .set('Authorization', 'Bearer user-1-token');

    expect(response.status).toBe(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('super-secret-client-secret');
    expect(body).not.toContain('super-secret-refresh-token');
    expect(body).not.toContain('super-secret-access-token');
  });

  it('GET /api/gmail/servers/:serverId does not return OAuth secrets', async () => {
    const response = await request(app)
      .get('/api/gmail/servers/server-1')
      .set('Authorization', 'Bearer user-1-token');

    expect(response.status).toBe(200);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('super-secret-client-secret');
    expect(body).not.toContain('super-secret-refresh-token');
    expect(body).not.toContain('super-secret-access-token');
  });
});

describe('DELETE /api/gmail/servers/:serverId — tenant isolation', () => {
  const tx = {
    gmailWatch: { deleteMany: jest.fn() },
    gmailTrigger: { deleteMany: jest.fn() },
    gmailAction: { deleteMany: jest.fn() },
    gmailServer: { deleteMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.gmailWatch.deleteMany.mockResolvedValue({ count: 0 });
    tx.gmailTrigger.deleteMany.mockResolvedValue({ count: 0 });
    tx.gmailAction.deleteMany.mockResolvedValue({ count: 0 });
    tx.gmailServer.deleteMany.mockResolvedValue({ count: 0 });
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  });

  it("does not delete another user's server data", async () => {
    // The authenticated caller is user 1; the server belongs to user 2.
    (client.gmailServer.findFirst as jest.Mock).mockResolvedValue(null);
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue({
      ...oauthServer,
      userId: 2,
    });

    const response = await request(app)
      .delete('/api/gmail/servers/server-1')
      .set('Authorization', 'Bearer user-1-token');

    expect(response.status).toBe(404);
    expect(tx.gmailWatch.deleteMany).not.toHaveBeenCalled();
    expect(tx.gmailTrigger.deleteMany).not.toHaveBeenCalled();
    expect(tx.gmailAction.deleteMany).not.toHaveBeenCalled();
  });
});
