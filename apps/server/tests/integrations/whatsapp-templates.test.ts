import request from 'supertest';
import express from 'express';
import client from '@repo/db';

jest.mock('jsonwebtoken', () => ({
  __esModule: true,
  default: {
    sign: jest.fn().mockReturnValue('mock-jwt-token'),
    verify: jest.fn((token: string) => {
      if (token === 'user-1-token') return { id: 1 };
      throw new Error('invalid token');
    }),
  },
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
  verify: jest.fn((token: string) => {
    if (token === 'user-1-token') return { id: 1 };
    throw new Error('invalid token');
  }),
}));

import WhatsAppRouter from '../../src/routes/WhatsAppRoutes';

const app = express();
app.use(express.json());
app.use('/api/whatsapp', WhatsAppRouter);

const server = {
  id: 'server-1',
  userId: 1,
  isActive: true,
  phoneNumberId: '109800000000001',
  businessId: 'biz-1',
  accessToken: 'EAAG-SECRET-TOKEN',
};

/**
 * A5 / Q-WA-A-02 — approved-template dropdown source. The route must list only
 * APPROVED templates, derive positional param counts from the BODY component,
 * scope the lookup to the caller's connection, and never leak the token.
 */
describe('GET /api/whatsapp/templates', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (client.whatsAppServer.findFirst as jest.Mock).mockResolvedValue(server);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/whatsapp/templates');
    expect(res.status).toBe(403);
  });

  it('returns approved templates with param counts from the BODY component', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            name: 'order_update',
            language: 'en',
            status: 'APPROVED',
            components: [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} is {{3}}' }],
          },
          {
            name: 'plain_note',
            language: 'en_US',
            status: 'APPROVED',
            components: [{ type: 'BODY', text: 'A plain note' }],
          },
          {
            name: 'pending_one',
            language: 'en',
            status: 'PENDING',
            components: [{ type: 'BODY', text: 'Hi {{1}}' }],
          },
        ],
      }),
    })) as unknown as typeof fetch;
    global.fetch = fetchMock;

    const res = await request(app)
      .get('/api/whatsapp/templates')
      .set('Authorization', 'Bearer user-1-token');

    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([
      { name: 'order_update', language: 'en', paramCount: 3, status: 'APPROVED' },
      { name: 'plain_note', language: 'en_US', paramCount: 0, status: 'APPROVED' },
    ]);
    // PENDING templates are excluded from the dropdown source.
    expect(JSON.stringify(res.body)).not.toContain('pending_one');
    // The WABA token never leaves the server.
    expect(JSON.stringify(res.body)).not.toContain('EAAG-SECRET-TOKEN');

    const [url, init] = (fetchMock as unknown as jest.Mock).mock.calls[0];
    expect(url).toContain('/biz-1/message_templates');
    expect((init as any).headers.Authorization).toBe('Bearer EAAG-SECRET-TOKEN');
    expect(client.whatsAppServer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 1, isActive: true }) })
    );
  });

  it('scopes the connection lookup by serverId when provided', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    })) as unknown as typeof fetch;

    await request(app)
      .get('/api/whatsapp/templates?serverId=server-9')
      .set('Authorization', 'Bearer user-1-token');

    expect(client.whatsAppServer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'server-9' }) })
    );
  });

  it('404s without an active connection and 502s when Meta rejects the call', async () => {
    (client.whatsAppServer.findFirst as jest.Mock).mockResolvedValueOnce(null);
    const missing = await request(app)
      .get('/api/whatsapp/templates')
      .set('Authorization', 'Bearer user-1-token');
    expect(missing.status).toBe(404);

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'Invalid OAuth access token',
    })) as unknown as typeof fetch;
    const rejected = await request(app)
      .get('/api/whatsapp/templates')
      .set('Authorization', 'Bearer user-1-token');
    expect(rejected.status).toBe(502);
    expect(JSON.stringify(rejected.body)).not.toContain('EAAG-SECRET-TOKEN');
  });
});
