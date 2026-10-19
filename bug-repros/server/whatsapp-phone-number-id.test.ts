/**
 * BUG: WhatsApp accounts can be connected with an empty `phoneNumberId`.
 * `ConnectWhatsAppSchema` (packages/types/src/index.ts) makes phoneNumberId
 * optional, and the web editor POSTs `phoneNumberId: ''`
 * (apps/web/components/modal/Modal.tsx). Because Prisma declares
 * `WhatsAppServer.phoneNumberId String @unique`, the FIRST empty-id row wins
 * and every later connect attempt fails with 400 "already registered" —
 * platform-wide, across tenants. Inbound webhooks also match triggers on
 * phoneNumberId, so a WhatsApp trigger registered with '' can never fire.
 *
 * Expected (green): connecting without a phone number id is rejected 400.
 */
import express from 'express';
import request from 'supertest';
import client from '@repo/db';

jest.mock('../../apps/server/src/middlewares', () => {
  const actual = jest.requireActual('../../apps/server/src/middlewares');
  return {
    ...actual,
    // Only bypass auth; keep the real validateBody so the schema itself is under test.
    authMiddleware: (req: any, _res: any, next: any) => {
      req.id = 1;
      next();
    },
  };
});

import WhatsAppRouter from '../../apps/server/src/routes/WhatsAppRoutes';

const app = express();
app.use(express.json());
app.use('/api/whatsapp', WhatsAppRouter);

const connect = (phoneNumberId: string) =>
  request(app).post('/api/whatsapp/servers').send({
    displayName: 'My WhatsApp',
    phoneNumberId,
    businessId: 'biz-1',
    accessToken: 'EAAG-secret',
    phoneNumber: '+911234567890',
  });

beforeEach(() => {
  jest.clearAllMocks();
  (client.whatsAppServer.findUnique as jest.Mock).mockResolvedValue(null);
  (client.whatsAppServer.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
    id: 'wserver-1',
    ...data,
  }));
});

describe('POST /api/whatsapp/servers phoneNumberId', () => {
  it('rejects an empty phone number id', async () => {
    const response = await connect('');

    expect(response.status).toBe(400);
    expect(client.whatsAppServer.create).not.toHaveBeenCalled();
  });

  it('rejects a missing phone number id', async () => {
    const response = await request(app).post('/api/whatsapp/servers').send({
      displayName: 'My WhatsApp',
      accessToken: 'EAAG-secret',
    });

    expect(response.status).toBe(400);
  });

  it('accepts a real phone number id', async () => {
    const response = await connect('109238475612');

    expect(response.status).toBe(201);
    expect(client.whatsAppServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phoneNumberId: '109238475612' }),
      })
    );
  });
});
