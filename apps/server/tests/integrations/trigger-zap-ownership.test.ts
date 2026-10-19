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
import TelegramRouter from '../../src/routes/TelegramRoutes';

const app = express();
app.use(express.json());
app.use('/api/whatsapp', WhatsAppRouter);
app.use('/api/telegram', TelegramRouter);

describe('POST /triggers — zap ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (client.whatsAppServer.findFirst as jest.Mock).mockResolvedValue({
      id: 'server-1',
      userId: 1,
    });
    (client.telegramBot.findFirst as jest.Mock).mockResolvedValue({
      id: 'bot-1',
      userId: 1,
    });
    (client.whatsAppTrigger.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
      id: 'trigger-1',
      ...data,
    }));
    (client.telegramTrigger.create as jest.Mock).mockImplementation(async ({ data }: any) => ({
      id: 'trigger-1',
      ...data,
    }));
  });

  it("does not attach a WhatsApp trigger to another user's zap", async () => {
    (client.zap.findFirst as jest.Mock).mockResolvedValue(null);

    const response = await request(app)
      .post('/api/whatsapp/triggers')
      .set('Authorization', 'Bearer user-1-token')
      .send({ serverId: 'server-1', zapId: 'victim-zap', eventType: 'message_received' });

    expect(response.status).toBe(404);
    expect(client.whatsAppTrigger.create).not.toHaveBeenCalled();
  });

  it("does not attach a Telegram trigger to another user's zap", async () => {
    (client.zap.findFirst as jest.Mock).mockResolvedValue(null);

    const response = await request(app)
      .post('/api/telegram/triggers')
      .set('Authorization', 'Bearer user-1-token')
      .send({ botId: 'bot-1', zapId: 'victim-zap', eventType: 'message' });

    expect(response.status).toBe(404);
    expect(client.telegramTrigger.create).not.toHaveBeenCalled();
  });
});
