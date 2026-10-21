import axios from 'axios';

const mockSendEmailWithTextBody = jest.fn();
const mockWhatsAppServerFindFirst = jest.fn();
const mockTelegramBotFindFirst = jest.fn();

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('@repo/email', () => ({
  sendEmailWithTextBody: (...args: any[]) => mockSendEmailWithTextBody(...args),
  sendZapFailureNotification: jest.fn(),
}));

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    whatsAppServer: {
      findFirst: (...args: any[]) => mockWhatsAppServerFindFirst(...args),
    },
    telegramBot: {
      findFirst: (...args: any[]) => mockTelegramBotFindFirst(...args),
    },
    zapRun: {
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { executeActionWithRetry } from '../src/index';
import { sendWebhook } from '../src/sendWebhook';
import { sendWhatsAppMessage, sendWhatsAppTemplateMessage } from '../src/sendWhatsApp';
import {
  sendTelegramMessage,
  sendTelegramPhoto,
  sendTelegramDocument,
  replyToMessage,
} from '../src/sendTelegram';

describe('Worker Action Execution Seams (Email, Webhook, WhatsApp, Telegram)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Email Action Seam', () => {
    it('interpolates placeholders in to, subject, and body and returns delivery output', async () => {
      mockSendEmailWithTextBody.mockResolvedValue({ id: 'email-123' });

      const result = await executeActionWithRetry(
        'Email',
        {
          to: '{customer.email}',
          subject: 'Order #{order.id} confirmed',
          body: 'Hi {customer.name}, total is ${order.total}.',
        },
        {
          customer: { email: 'ada@lovelace.org', name: 'Ada' },
          order: { id: '9001', total: '49.00' },
        }
      );

      expect(result.success).toBe(true);
      expect(mockSendEmailWithTextBody).toHaveBeenCalledWith(
        'ada@lovelace.org',
        'Order #9001 confirmed',
        'Hi Ada, total is $49.00.'
      );
      expect(result.data?.output).toEqual(
        expect.objectContaining({
          to: 'ada@lovelace.org',
          subject: 'Order #9001 confirmed',
        })
      );
    });
  });

  describe('Webhook Action Seam', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('interpolates URL and JSON body placeholders and captures JSON response output', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({ delivered: true, id: 'wh-out-1' }),
      });
      global.fetch = fetchMock as any;

      const result = await executeActionWithRetry(
        'Webhook',
        {
          url: 'https://api.example.com/events/{event_type}',
          method: 'POST',
          headers: { 'X-Custom': 'zapmate' },
          body: { user: '{sender.login}', repo: '{repository.name}' },
        },
        {
          event_type: 'push',
          sender: { login: 'octocat' },
          repository: { name: 'zapier' },
        }
      );

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/events/push',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'zapmate',
          }),
          body: JSON.stringify({ user: 'octocat', repo: 'zapier' }),
        })
      );
      expect(result.data?.output).toEqual({
        url: 'https://api.example.com/events/push',
        statusCode: 201,
        response: { delivered: true, id: 'wh-out-1' },
      });
    });

    it('rejects invalid URLs and omits request body on GET requests', async () => {
      const bad = await sendWebhook({ url: 'not-a-valid-url', method: 'POST' });
      expect(bad.success).toBe(false);
      expect(bad.error).toBe('Invalid URL');

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        text: async () => 'pong',
      });
      global.fetch = fetchMock as any;

      const getRes = await sendWebhook({
        url: 'https://api.example.com/ping',
        method: 'GET',
        body: { ignored: true },
      });
      expect(getRes.success).toBe(true);
      expect(getRes.response).toBe('pong');
      expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    });
  });

  describe('WhatsApp Action Seam', () => {
    it('normalizes recipient phone number, resolves serverId credentials, and posts to Meta Graph API', async () => {
      mockWhatsAppServerFindFirst.mockResolvedValue({
        id: 'wa-srv-1',
        phoneNumberId: '10987654321',
        accessToken: 'meta-secret-token',
        isActive: true,
      });
      mockedAxios.post.mockResolvedValue({
        data: { messages: [{ id: 'wamid.out.1' }] },
      });

      const result = await executeActionWithRetry(
        'WhatsApp Send Message',
        {
          serverId: 'wa-srv-1',
          to: '+1 (415) 555-2671',
          message: 'Alert for {fromName}: {text}',
        },
        {
          fromName: 'Linus',
          text: 'Kernel build passed',
        }
      );

      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://graph.facebook.com/v18.0/10987654321/messages',
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '14155552671',
          type: 'text',
          text: {
            preview_url: true,
            body: 'Alert for Linus: Kernel build passed',
          },
        },
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer meta-secret-token',
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        })
      );
    });

    it('supports WhatsApp template messages and surfaces Meta API errors', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { messages: [{ id: 'wamid.tpl.1' }] },
      });
      const tpl = await sendWhatsAppTemplateMessage(
        'pn-1',
        'tok-1',
        '+91 98765 43210',
        'order_update',
        'en_US'
      );
      expect(tpl.success).toBe(true);
      expect(tpl.messageId).toBe('wamid.tpl.1');

      mockedAxios.post.mockRejectedValueOnce({
        response: { data: { error: { message: 'Invalid OAuth access token.' } } },
      });
      const failed = await sendWhatsAppMessage('pn-1', 'bad-tok', '14155550000', 'hi');
      expect(failed.success).toBe(false);
      expect(failed.error).toBe('Invalid OAuth access token.');
    });
  });

  describe('Telegram Action Seam', () => {
    it('resolves botId token, interpolates chatId and message, and calls Telegram Bot API', async () => {
      mockTelegramBotFindFirst.mockResolvedValue({
        id: 'bot-1',
        botToken: '999999:ABCDEF',
        isActive: true,
      });
      mockedAxios.post.mockResolvedValue({
        data: { result: { message_id: 777 } },
      });

      const result = await executeActionWithRetry(
        'Telegram Send Message',
        {
          botId: 'bot-1',
          chatId: '{chatId}',
          message: 'Hello {firstName}, command args: {commandArgs}',
        },
        {
          chatId: -100123456,
          firstName: 'Margaret',
          commandArgs: 'deploy prod',
        }
      );

      expect(result.success).toBe(true);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.telegram.org/bot999999:ABCDEF/sendMessage',
        {
          chat_id: '-100123456',
          text: 'Hello Margaret, command args: deploy prod',
          parse_mode: 'HTML',
        },
        { timeout: 10000 }
      );
      expect(result.data?.output).toEqual(
        expect.objectContaining({
          chatId: '-100123456',
        })
      );
    });

    it('supports photo, document, and reply helpers and surfaces Bot API descriptions on error', async () => {
      mockedAxios.post.mockResolvedValue({ data: { result: { message_id: 88 } } });
      expect((await sendTelegramPhoto('tok', 123, 'https://img.example/a.png', 'cap')).success).toBe(
        true
      );
      expect(
        (await sendTelegramDocument('tok', 123, 'https://doc.example/a.pdf', 'doc')).success
      ).toBe(true);
      expect((await replyToMessage('tok', 123, 55, 'reply text')).success).toBe(true);

      mockedAxios.post.mockRejectedValueOnce({
        response: { data: { description: 'Bad Request: chat not found' } },
      });
      const err = await sendTelegramMessage('tok', 999, 'text');
      expect(err.success).toBe(false);
      expect(err.error).toBe('Bad Request: chat not found');
    });
  });
});
