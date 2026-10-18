import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { Request, Response } from 'express';
import client from '@repo/db';
import CronRouter from '../../src/routes/CronRoutes';
import {
  handleGmailWebhook,
  verifyGmailWebhookSignature,
} from '../../src/controllers/GmailWebhookController';
import { handleWebhook, verifyWebhookSignature } from '../../src/controllers/TriggerController';
import {
  verifyWebhookRequest,
  verifyWebhookSignature as verifyHooksSignature,
} from '../../../hooks/src/webhookAuth';

/**
 * Regression tests for the fail-open security findings in
 * reports/karpathy-guidelines-audit.md (Principle 1: "don't assume").
 *
 * Every test below fails against the pre-fix code, where a missing secret
 * meant "skip verification" instead of "reject".
 */

const cronApp = express();
cronApp.use(express.json());
cronApp.use('/api/cron', CronRouter);

const buildRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Security - Gmail webhook signature', () => {
  const body = { message: { data: 'x', messageId: '1', publishTime: 'now' } };

  it('rejects the notification when GMAIL_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.GMAIL_WEBHOOK_SECRET;

    expect(verifyGmailWebhookSignature({ 'x-goog-signature': 'anything' }, body)).toBe(false);

    const { res, status } = buildRes();
    await handleGmailWebhook(
      { body, headers: { 'x-goog-signature': 'anything' } } as unknown as Request,
      res
    );

    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with no signature header', () => {
    process.env.GMAIL_WEBHOOK_SECRET = 'gmail-secret';
    expect(verifyGmailWebhookSignature({}, body)).toBe(false);
  });

  it('accepts a correctly signed notification', () => {
    process.env.GMAIL_WEBHOOK_SECRET = 'gmail-secret';
    const signature = crypto
      .createHmac('sha256', 'gmail-secret')
      .update(JSON.stringify(body))
      .digest('hex');

    expect(verifyGmailWebhookSignature({ 'x-goog-signature': signature }, body)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    process.env.GMAIL_WEBHOOK_SECRET = 'gmail-secret';
    const signatureForOriginal = crypto
      .createHmac('sha256', 'gmail-secret')
      .update(JSON.stringify(body))
      .digest('hex');

    const tampered = { ...body, message: { ...body.message, messageId: '2' } };
    expect(
      verifyGmailWebhookSignature({ 'x-goog-signature': signatureForOriginal }, tampered)
    ).toBe(false);
  });
});

describe('Security - TriggerController webhook signature', () => {
  const payload = { event: 'test' };
  const signedRequest = (secret: string, signature?: string) => {
    const headers: Record<string, string> = {};
    if (signature) headers['x-webhook-signature'] = signature;
    return {
      params: { zapId: 'zap-123' },
      body: payload,
      headers,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any as Request;
  };

  it('requires a signature when WEBHOOK_SECRET is configured', async () => {
    process.env.WEBHOOK_SECRET = 'webhook-secret';

    const { res, status, json } = buildRes();
    await handleWebhook(signedRequest('webhook-secret'), res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Webhook signature required' })
    );
  });

  it('rejects an invalid signature when WEBHOOK_SECRET is configured', async () => {
    process.env.WEBHOOK_SECRET = 'webhook-secret';

    const { res, status } = buildRes();
    await handleWebhook(signedRequest('webhook-secret', 'sha256=deadbeef'), res);

    expect(status).toHaveBeenCalledWith(401);
  });

  it('accepts a correctly signed request', async () => {
    process.env.WEBHOOK_SECRET = 'webhook-secret';
    const signature = `sha256=${crypto
      .createHmac('sha256', 'webhook-secret')
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    const { res, status } = buildRes();
    await handleWebhook(signedRequest('webhook-secret', signature), res);

    expect(status).toHaveBeenCalledWith(200);
  });

  it('does not verify against a hardcoded fallback key', () => {
    delete process.env.WEBHOOK_SECRET;
    const forgedForDefaultSecret = `sha256=${crypto
      .createHmac('sha256', 'default-secret')
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    expect(verifyWebhookSignature(JSON.stringify(payload), forgedForDefaultSecret)).toBe(false);
  });

  it('still accepts unsigned webhooks when no secret is configured (capability-URL model)', async () => {
    delete process.env.WEBHOOK_SECRET;

    const { res, status } = buildRes();
    await handleWebhook(signedRequest(''), res);

    expect(status).toHaveBeenCalledWith(200);
  });
});

describe('Security - Cron endpoints fail closed', () => {
  it('rejects when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await request(cronApp).get('/api/cron/process-schedules');

    expect(response.status).toBe(401);
  });

  it('rejects a wrong secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';

    const response = await request(cronApp)
      .get('/api/cron/process-schedules')
      .set('x-cron-secret', 'not-the-secret');

    expect(response.status).toBe(401);
  });

  it('accepts the correct secret', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    (client.scheduledTrigger.findMany as jest.Mock).mockResolvedValue([]);

    const response = await request(cronApp)
      .get('/api/cron/process-schedules')
      .set('x-cron-secret', 'cron-secret');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('success', true);
  });

  it('writes ZapRunOutbox for due schedules so runs are never orphaned in pending (F6)', async () => {
    process.env.CRON_SECRET = 'cron-secret';
    (client.scheduledTrigger.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'sched-1',
        zapId: 'zap-1',
        scheduleType: 'minutely',
        minute: 0,
        timezone: 'UTC',
        zap: { id: 'zap-1', name: 'Minute Zap', isActive: true },
      },
    ]);
    (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-sched-1' });
    (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({
      id: 'outbox-1',
      zapRunId: 'run-sched-1',
    });
    (client.scheduledTrigger.update as jest.Mock).mockResolvedValue({});

    const response = await request(cronApp)
      .get('/api/cron/process-schedules')
      .set('x-cron-secret', 'cron-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        success: true,
        processed: 1,
      })
    );
    expect(client.zapRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          zapId: 'zap-1',
          metadata: expect.objectContaining({
            triggerType: 'schedule',
            scheduleType: 'minutely',
          }),
        }),
      })
    );
    expect(client.zapRunOutbox.create).toHaveBeenCalledWith({
      data: { zapRunId: 'run-sched-1' },
    });
    expect(client.scheduledTrigger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sched-1' },
      })
    );
  });
});

describe('Security - Hooks generic webhook authentication (F5)', () => {
  const payload = { event_id: 'evt-1', amount: 42 };

  it('requires a signature or secret when WEBHOOK_SECRET is configured', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    const result = verifyWebhookRequest({}, payload);

    expect(result).toEqual({
      authorized: false,
      status: 401,
      message: 'Webhook signature required',
    });
  });

  it('rejects an invalid HMAC signature or wrong shared secret', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    expect(verifyWebhookRequest({ 'x-webhook-signature': 'sha256=bad' }, payload)).toEqual({
      authorized: false,
      status: 401,
      message: 'Invalid webhook signature',
    });

    expect(verifyWebhookRequest({ 'x-webhook-secret': 'wrong-secret' }, payload)).toEqual({
      authorized: false,
      status: 401,
      message: 'Invalid webhook signature',
    });
  });

  it('accepts a valid HMAC-SHA256 x-webhook-signature header', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';
    const sig = `sha256=${crypto
      .createHmac('sha256', 'hooks-secret')
      .update(JSON.stringify(payload))
      .digest('hex')}`;

    expect(verifyWebhookRequest({ 'x-webhook-signature': sig }, payload)).toEqual({
      authorized: true,
    });
  });

  it('accepts a valid x-webhook-secret or Bearer token', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    expect(verifyWebhookRequest({ 'x-webhook-secret': 'hooks-secret' }, payload)).toEqual({
      authorized: true,
    });
    expect(verifyWebhookRequest({ authorization: 'Bearer hooks-secret' }, payload)).toEqual({
      authorized: true,
    });
  });

  it('honors per-trigger metadata.secret over WEBHOOK_SECRET', () => {
    process.env.WEBHOOK_SECRET = 'global-secret';
    const triggerMeta = { secret: 'per-zap-secret' };

    expect(
      verifyWebhookRequest({ 'x-webhook-secret': 'global-secret' }, payload, triggerMeta)
    ).toEqual({
      authorized: false,
      status: 401,
      message: 'Invalid webhook signature',
    });

    expect(
      verifyWebhookRequest({ 'x-webhook-secret': 'per-zap-secret' }, payload, triggerMeta)
    ).toEqual({
      authorized: true,
    });
  });

  it('allows capability-URL requests when neither trigger nor env secret is set, without using a default key', () => {
    delete process.env.WEBHOOK_SECRET;

    expect(verifyWebhookRequest({}, payload)).toEqual({ authorized: true });
    expect(verifyHooksSignature(JSON.stringify(payload), 'sha256=anything')).toBe(false);
  });
});
