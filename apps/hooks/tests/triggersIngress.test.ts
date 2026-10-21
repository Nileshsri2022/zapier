import crypto from 'crypto';

const enqueueRun = jest.fn();
const isDuplicateEvent = jest.fn();
const zapFindUnique = jest.fn();
const zapFindFirst = jest.fn();
const whatsAppTriggerFindMany = jest.fn();
const whatsAppTriggerUpdate = jest.fn();
const googleCalendarTriggerFindFirst = jest.fn();
const googleCalendarTriggerUpdate = jest.fn();
const googleCalendarServerUpdate = jest.fn();
const eventsList = jest.fn();

jest.mock('@repo/runs', () => ({
  enqueueRun: (...args: any[]) => enqueueRun(...args),
  disconnectRunDispatcher: jest.fn(),
}));

jest.mock('@repo/redis', () => ({
  isDuplicateEvent: (...args: any[]) => isDuplicateEvent(...args),
}));

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    zap: {
      findUnique: (...args: any[]) => zapFindUnique(...args),
      findFirst: (...args: any[]) => zapFindFirst(...args),
    },
    whatsAppTrigger: {
      findMany: (...args: any[]) => whatsAppTriggerFindMany(...args),
      update: (...args: any[]) => whatsAppTriggerUpdate(...args),
    },
    googleCalendarTrigger: {
      findFirst: (...args: any[]) => googleCalendarTriggerFindFirst(...args),
      update: (...args: any[]) => googleCalendarTriggerUpdate(...args),
    },
    googleCalendarServer: {
      update: (...args: any[]) => googleCalendarServerUpdate(...args),
    },
  },
}));

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn().mockResolvedValue({ credentials: {} }),
      })),
    },
    calendar: jest.fn().mockImplementation(() => ({
      events: {
        list: (...args: any[]) => eventsList(...args),
      },
    })),
  },
}));

import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from '../src/whatsappHandler';
import { handleGoogleCalendarWebhook } from '../src/googleCalendarHandler';
import { verifyWebhookRequest } from '../src/webhookAuth';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: any) {
      this.body = payload;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    sendStatus(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
}

describe('Hooks Trigger Ingress Seams (Webhook, WhatsApp, Google Calendar Push)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-123' });
    isDuplicateEvent.mockResolvedValue(false);
  });

  describe('Webhook Trigger Authentication Seam (verifyWebhookRequest)', () => {
    it('allows unsigned requests when no secret is configured', () => {
      delete process.env.WEBHOOK_SECRET;
      const result = verifyWebhookRequest({}, { hello: 'world' }, {});
      expect(result.authorized).toBe(true);
    });

    it('verifies HMAC-SHA256 signature and shared secret headers against trigger metadata secret', () => {
      const payload = { orderId: 'ord-1', event_id: 'evt-99' };
      const secret = 'super-secret-hook-key';
      const hmac = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      expect(
        verifyWebhookRequest(
          { 'x-webhook-signature': `sha256=${hmac}` },
          payload,
          { secret }
        ).authorized
      ).toBe(true);

      expect(
        verifyWebhookRequest({ 'x-webhook-secret': secret }, payload, { secret }).authorized
      ).toBe(true);

      expect(
        verifyWebhookRequest({ 'x-webhook-secret': 'wrong' }, payload, { secret }).authorized
      ).toBe(false);
    });
  });

  describe('WhatsApp Trigger Ingress Seam', () => {
    it('verifies Meta GET challenge when hub.verify_token matches and rejects invalid tokens', async () => {
      const okRes = createMockRes();
      await verifyWhatsAppWebhook(
        {
          query: {
            'hub.mode': 'subscribe',
            'hub.verify_token': 'zapmate_whatsapp_verify',
            'hub.challenge': 'challenge-accepted-42',
          },
        } as any,
        okRes
      );
      expect(okRes.statusCode).toBe(200);
      expect(okRes.body).toBe('challenge-accepted-42');

      const badRes = createMockRes();
      await verifyWhatsAppWebhook(
        {
          query: {
            'hub.mode': 'subscribe',
            'hub.verify_token': 'wrong-token',
            'hub.challenge': 'challenge-accepted-42',
          },
        } as any,
        badRes
      );
      expect(badRes.statusCode).toBe(403);
    });

    it('hydrates incoming WhatsApp message, deduplicates by wamid, and updates lastProcessedAt', async () => {
      whatsAppTriggerFindMany.mockResolvedValue([
        { id: 'wa-trig-1', zapId: 'zap-wa-1', server: { id: 'srv-1', phoneNumberId: 'pn-1' } },
      ]);
      zapFindFirst.mockResolvedValue({ id: 'zap-wa-1', name: 'WA Zap', isActive: true });
      whatsAppTriggerUpdate.mockResolvedValue({});

      const res = createMockRes();
      await handleWhatsAppWebhook(
        {
          body: {
            object: 'whatsapp_business_account',
            entry: [
              {
                changes: [
                  {
                    value: {
                      metadata: { phone_number_id: 'pn-1' },
                      contacts: [{ profile: { name: 'Grace Hopper' } }],
                      messages: [
                        {
                          id: 'wamid.HBgM',
                          from: '14155550199',
                          timestamp: '1700000000',
                          type: 'text',
                          text: { body: 'Ship the compiler' },
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        } as any,
        res
      );

      // Wait microtask for async processWhatsAppMessage
      await new Promise((r) => setImmediate(r));

      expect(res.statusCode).toBe(200);
      expect(enqueueRun).toHaveBeenCalledWith({
        zapId: 'zap-wa-1',
        source: 'hooks.whatsapp',
        dedup: { scope: 'whatsapp', key: 'zap-wa-1:wamid.HBgM' },
        metadata: expect.objectContaining({
          from: '14155550199',
          fromName: 'Grace Hopper',
          messageId: 'wamid.HBgM',
          text: 'Ship the compiler',
          phoneNumberId: 'pn-1',
        }),
      });
      expect(whatsAppTriggerUpdate).toHaveBeenCalledWith({
        where: { id: 'wa-trig-1' },
        data: { lastProcessedAt: expect.any(Date) },
      });
    });
  });

  describe('Google Calendar Push Webhook Seam', () => {
    it('acknowledges sync notifications without querying or enqueueing runs', async () => {
      const res = createMockRes();
      await handleGoogleCalendarWebhook(
        {
          headers: {
            'x-goog-channel-id': 'chan-1',
            'x-goog-resource-id': 'res-1',
            'x-goog-resource-state': 'sync',
            'x-goog-message-number': '1',
          },
        } as any,
        res
      );

      expect(res.statusCode).toBe(200);
      expect(googleCalendarTriggerFindFirst).not.toHaveBeenCalled();
    });

    it('fetches changed events with syncToken, enqueues ZapRun via @repo/runs, and advances syncToken', async () => {
      const ts = new Date().toISOString();
      googleCalendarTriggerFindFirst.mockResolvedValue({
        id: 'cal-trig-1',
        zapId: 'zap-cal-1',
        calendarId: 'primary',
        triggerType: 'new_event',
        syncToken: 'old-sync-token',
        zap: { id: 'zap-cal-1', isActive: true },
        server: {
          id: 'srv-cal-1',
          accessToken: 'tok',
          refreshToken: 'ref',
          tokenExpiry: new Date(Date.now() + 3600_000),
        },
      });
      eventsList.mockResolvedValue({
        data: {
          items: [
            {
              id: 'cal-evt-99',
              summary: 'Product Launch',
              status: 'confirmed',
              created: ts,
              updated: ts,
            },
          ],
          nextSyncToken: 'new-sync-token',
        },
      });

      const res = createMockRes();
      await handleGoogleCalendarWebhook(
        {
          headers: {
            'x-goog-channel-id': 'chan-1',
            'x-goog-resource-id': 'res-1',
            'x-goog-resource-state': 'exists',
            'x-goog-message-number': '42',
          },
        } as any,
        res
      );

      expect(isDuplicateEvent).toHaveBeenCalledWith('calendar', 'chan-1:42');
      expect(enqueueRun).toHaveBeenCalledWith(
        expect.objectContaining({
          zapId: 'zap-cal-1',
          source: 'hooks.calendar-push',
          metadata: expect.objectContaining({
            trigger_type: 'new_event',
            event_id: 'cal-evt-99',
            summary: 'Product Launch',
          }),
        })
      );
      expect(googleCalendarTriggerUpdate).toHaveBeenCalledWith({
        where: { id: 'cal-trig-1' },
        data: { syncToken: 'new-sync-token' },
      });
    });
  });
});
