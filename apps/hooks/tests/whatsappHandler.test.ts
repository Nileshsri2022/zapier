import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import {
  verifyWhatsAppWebhook,
  handleWhatsAppWebhook,
  buildWhatsAppRunPayload,
  normalizeMessageType,
} from '../src/whatsappHandler';

/**
 * T6 fixtures (docs/ask-matt/triggers/whatsapp.md round 8, T-WA-T-02):
 * verify challenge, mandatory signature (missing/invalid/no-config),
 * messageId redelivery, phone-number-id filter, text/media/unknown types,
 * status-callback ack, batch fan-out.
 */

const app = express();
app.use(express.json({ verify: (req: any, _r: any, b: Buffer) => (req.rawBody = b) }));
app.get('/api/webhooks/whatsapp', verifyWhatsAppWebhook as any);
app.post('/api/webhooks/whatsapp', handleWhatsAppWebhook as any);

const APP_SECRET = 'meta-app-secret-123';

const signedPost = (payload: object, opts: { signature?: string | null } = {}) => {
  const raw = JSON.stringify(payload);
  const req = request(app).post('/api/webhooks/whatsapp');
  if (opts.signature === null) return req.send(payload);
  const sig =
    opts.signature ?? `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
  return req.set('X-Hub-Signature-256', sig).send(payload);
};

const textMessagePayload = (overrides: any = {}) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '1098765' },
            contacts: [{ profile: { name: 'Ada' }, wa_id: '919876543210' }],
            messages: [
              {
                from: '919876543210',
                id: 'wamid.HBgLMOTk4NzY1NDMyMTABCA==',
                timestamp: '1761012842',
                type: 'text',
                text: { body: 'Hi, where is my order?' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
    ...(overrides.entryExtra || []),
  ],
});

let mockTriggers: any[] = [];
const mockTriggerUpdate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
  mockTriggerUpdate.mockResolvedValue({});
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = 'vt-1';
  mockTriggers = [
    {
      id: 'wt-1',
      zapId: 'zap-1',
      serverId: 'wserver-1',
      isActive: true,
      server: { id: 'wserver-1', phoneNumberId: '1098765', isActive: true },
    },
  ];
  (client.whatsAppTrigger.findMany as jest.Mock).mockImplementation(async () => mockTriggers);
  (client.whatsAppTrigger.update as jest.Mock) = mockTriggerUpdate;
  (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-1', isActive: true });
});

afterEach(() => {
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
});

describe('GET verification challenge', () => {
  it('echoes hub.challenge when mode+token match', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'vt-1', 'hub.challenge': 'ch@123' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('ch@123');
  });

  it('rejects a wrong verify token', async () => {
    const res = await request(app)
      .get('/api/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'x' });
    expect(res.status).toBe(403);
  });
});

describe('mandatory signature (Q-WA-T-04)', () => {
  it('signed inbound text message → 200 with the full §4 contract and one run', async () => {
    const payload = textMessagePayload();
    const res = await signedPost(payload);

    expect(res.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const input = mockEnqueueRun.mock.calls[0][0];
    expect(input.metadata).toMatchObject({
      event: 'message',
      messageId: 'wamid.HBgLMOTk4NzY1NDMyMTABCA==',
      from: '919876543210',
      fromProfileName: 'Ada',
      chatId: '919876543210',
      phoneNumberId: '1098765',
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      type: 'text',
      text: { body: 'Hi, where is my order?' },
      media: null,
      caption: null,
      raw: payload,
    });
    // legacy aliases
    expect(input.metadata.fromName).toBe('Ada');
    expect(input.metadata.email).toBe('919876543210@whatsapp.placeholder');
    expect(input.dedup).toEqual({
      scope: 'whatsapp',
      key: 'zap-1:wamid.HBgLMOTk4NzY1NDMyMTABCA==',
    });
  });

  it('missing signature → 401, security log, no run', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await signedPost(textMessagePayload(), { signature: null });

    expect(res.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('security'));
    errorSpy.mockRestore();
  });

  it('invalid signature → 401, no run', async () => {
    const res = await signedPost(textMessagePayload(), { signature: 'sha256=deadbeef' });
    expect(res.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('app secret not configured → fail closed with 401 (cannot verify)', async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await signedPost(textMessagePayload());
    expect(res.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not configured'));
    errorSpy.mockRestore();
  });
});

describe('phone-number-id filter (Q-WA-T-05)', () => {
  it('message for a different number id → 200 ack, no run', async () => {
    mockTriggers = []; // findMany where-clause excludes other numbers
    const res = await signedPost(textMessagePayload());
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});

describe('message types + media (Q-WA-T-03)', () => {
  it('document message surfaces media metadata (id, mimeType, filename, sha256, caption)', async () => {
    const payload = textMessagePayload();
    const msg = payload.entry[0].changes[0].value.messages[0];
    msg.type = 'document';
    msg.document = {
      id: 'media-doc-1',
      mime_type: 'application/pdf',
      filename: 'invoice.pdf',
      sha256: 'abc123',
      caption: 'Your invoice',
    };
    delete msg.text;

    const res = await signedPost(payload);
    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.type).toBe('document');
    expect(metadata.media).toEqual({
      id: 'media-doc-1',
      mimeType: 'application/pdf',
      filename: 'invoice.pdf',
      sha256: 'abc123',
      caption: 'Your invoice',
    });
    expect(metadata.caption).toBe('Your invoice');
    expect(metadata.mediaId).toBe('media-doc-1');
  });

  it('unknown type still fires with type unknown and raw intact', async () => {
    const payload = textMessagePayload();
    const msg = payload.entry[0].changes[0].value.messages[0];
    msg.type = 'some_new_kind';
    msg.some_new_kind = { exotic: true };
    delete msg.text;

    const res = await signedPost(payload);
    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.type).toBe('unknown');
    expect(metadata.raw).toEqual(payload);
    expect(metadata.raw.entry[0].changes[0].value.messages[0].some_new_kind).toEqual({
      exotic: true,
    });
  });

  it('normalizeMessageType maps unknown values to the spec enum', () => {
    expect(normalizeMessageType('location')).toBe('location');
    expect(normalizeMessageType('weird')).toBe('unknown');
    expect(normalizeMessageType(undefined)).toBe('unknown');
  });

  it('buildWhatsAppRunPayload passes through non-ISO timestamp inputs safely', () => {
    const p = buildWhatsAppRunPayload(
      { id: 'm', from: '1', timestamp: 'not-a-number', type: 'text', text: { body: 'x' } },
      null,
      'pn',
      {}
    );
    expect(p.timestamp).toBeNull();
    expect(p.event).toBe('message');
  });
});

describe('redelivery + non-message events', () => {
  it('identical redelivery → same messageId dedupe key, ack stays 200, clock only on queued', async () => {
    const payload = textMessagePayload();

    mockEnqueueRun.mockResolvedValueOnce({ status: 'queued', zapRunId: 'run-1' });
    const first = await signedPost(payload);
    expect(first.status).toBe(200);
    expect(mockTriggerUpdate).toHaveBeenCalledTimes(1);

    mockEnqueueRun.mockResolvedValueOnce({ status: 'duplicate' });
    const second = await signedPost(payload);
    expect(second.status).toBe(200);

    const keys = mockEnqueueRun.mock.calls.map((c: any[]) => c[0].dedup.key);
    expect(keys[0]).toBe(keys[1]);
    expect(mockTriggerUpdate).toHaveBeenCalledTimes(1); // duplicate does not advance
  });

  it('status callback (no messages array) → 200 ack, no run', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1098765' },
                statuses: [{ id: 'wamid.x', status: 'delivered' }],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };
    const res = await signedPost(payload);
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('batch with two messages → one run each, per-message dedupe keys', async () => {
    const payload = textMessagePayload();
    const messages = payload.entry[0].changes[0].value.messages;
    messages.push({
      from: '919876543210',
      id: 'wamid.SECOND',
      timestamp: '1761012899',
      type: 'text',
      text: { body: 'Second one' },
    });

    const res = await signedPost(payload);
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);
    const keys = mockEnqueueRun.mock.calls.map((c: any[]) => c[0].dedup.key);
    expect(keys).toEqual(['zap-1:wamid.HBgLMOTk4NzY1NDMyMTABCA==', 'zap-1:wamid.SECOND']);
  });

  it('non-WhatsApp object acks 200 without a run', async () => {
    const res = await signedPost({ object: 'page', entry: [] });
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});
