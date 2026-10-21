import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { Request, Response } from 'express';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import CronRouter from '../../src/routes/CronRoutes';
import { handleGmailWebhook } from '../../src/controllers/GmailWebhookController';
import { handleWebhook } from '../../src/controllers/TriggerController';
// Every ingress decision comes from one deep module; these tests exercise the
// named entry points the call sites use, not a shared private helper.
import {
  resolveAuthMode,
  resolveWebhookSecret,
  verifyCatchHook,
  verifyGmailPush,
  verifyLegacyWebhook,
} from '@repo/ingress';

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

beforeEach(() => {
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockResolvedValue({
    status: 'queued',
    zapRunId: 'run-sched-1',
    dispatched: true,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('Security - Gmail webhook signature', () => {
  const body = { message: { data: 'x', messageId: '1', publishTime: 'now' } };
  const rawBody = JSON.stringify(body);
  const sign = (secret: string, payload = rawBody) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

  it('rejects the notification when GMAIL_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.GMAIL_WEBHOOK_SECRET;

    expect(
      verifyGmailPush({ headers: { 'x-goog-signature': 'anything' }, rawBody }, undefined).ok
    ).toBe(false);

    const { res, status } = buildRes();
    await handleGmailWebhook(
      {
        body,
        rawBody: Buffer.from(rawBody),
        headers: { 'x-goog-signature': 'anything' },
      } as unknown as Request,
      res
    );

    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects a request with no signature header', () => {
    expect(verifyGmailPush({ headers: {}, rawBody }, 'gmail-secret').ok).toBe(false);
  });

  it('accepts a correctly signed notification', () => {
    const signature = sign('gmail-secret');

    expect(
      verifyGmailPush({ headers: { 'x-goog-signature': signature }, rawBody }, 'gmail-secret').ok
    ).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const signatureForOriginal = sign('gmail-secret');
    const tamperedRaw = JSON.stringify({ ...body, message: { ...body.message, messageId: '2' } });

    expect(
      verifyGmailPush(
        { headers: { 'x-goog-signature': signatureForOriginal }, rawBody: tamperedRaw },
        'gmail-secret'
      ).ok
    ).toBe(false);
  });

  it('signs the raw bytes, not a re-serialized body (Q8/Q11)', () => {
    // Same JSON value, different bytes: only the bytes the sender signed count.
    const spaced = '{ "message": { "data": "x", "messageId": "1", "publishTime": "now" } }';
    const signatureOverSpaced = sign('gmail-secret', spaced);
    const signatureOverReserialized = sign('gmail-secret', JSON.stringify(JSON.parse(spaced)));

    expect(
      verifyGmailPush(
        { headers: { 'x-goog-signature': signatureOverSpaced }, rawBody: spaced },
        'gmail-secret'
      ).ok
    ).toBe(true);
    // The old JSON.stringify(body) digest would have matched the second one.
    expect(
      verifyGmailPush(
        { headers: { 'x-goog-signature': signatureOverReserialized }, rawBody: spaced },
        'gmail-secret'
      ).ok
    ).toBe(false);
  });

  it('verifies through the controller over the captured raw bytes', async () => {
    process.env.GMAIL_WEBHOOK_SECRET = 'gmail-secret';
    const raw = '{ "message": { "data": "x" } }';
    const { res, status } = buildRes();
    const req = {
      body: JSON.parse(raw),
      rawBody: Buffer.from(raw),
      headers: { 'x-goog-signature': sign('gmail-secret', raw) },
    } as unknown as Request;

    await handleGmailWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(401);
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

    expect(verifyLegacyWebhook(JSON.stringify(payload), forgedForDefaultSecret, undefined).ok).toBe(
      false
    );
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

  it('queues due schedules through run intake so nextRunAt only advances on a real run (F6)', async () => {
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
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-1',
        source: 'server.schedule',
        metadata: expect.objectContaining({
          triggerType: 'schedule',
          scheduleType: 'minutely',
        }),
      })
    );
    expect(client.scheduledTrigger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sched-1' },
      })
    );
  });
});

describe('Security - Hooks generic webhook authentication (F5)', () => {
  const payload = { event_id: 'evt-1', amount: 42 };
  const rawBody = JSON.stringify(payload);

  /** Exactly what `catchHook` does: resolve the hook's policy, ask the engine. */
  const check = (headers: Record<string, string | string[] | undefined>, triggerMeta?: unknown) =>
    verifyCatchHook(
      { headers, body: payload, rawBody },
      { authMode: resolveAuthMode(triggerMeta), secret: resolveWebhookSecret(triggerMeta) }
    );

  it('requires a signature or secret when WEBHOOK_SECRET is configured', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    expect(check({})).toEqual({
      ok: false,
      code: 'MISSING_CREDENTIAL',
      status: 401,
      message: expect.any(String),
    });
  });

  it('rejects an invalid HMAC signature or wrong shared secret', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    expect(check({ 'x-webhook-signature': 'sha256=bad' })).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
      status: 401,
    });
    expect(check({ 'x-webhook-secret': 'wrong-secret' })).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
      status: 401,
    });
  });

  it('accepts a valid HMAC-SHA256 x-webhook-signature header', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';
    const sig = `sha256=${crypto.createHmac('sha256', 'hooks-secret').update(rawBody).digest('hex')}`;

    expect(check({ 'x-webhook-signature': sig })).toEqual({ ok: true });
  });

  it('accepts a valid x-webhook-secret or Bearer token', () => {
    process.env.WEBHOOK_SECRET = 'hooks-secret';

    expect(check({ 'x-webhook-secret': 'hooks-secret' })).toEqual({ ok: true });
    expect(check({ authorization: 'Bearer hooks-secret' })).toEqual({ ok: true });
  });

  it('honors per-trigger metadata.secret over WEBHOOK_SECRET', () => {
    process.env.WEBHOOK_SECRET = 'global-secret';
    const triggerMeta = { secret: 'per-zap-secret' };

    expect(check({ 'x-webhook-secret': 'global-secret' }, triggerMeta)).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
      status: 401,
    });
    expect(check({ 'x-webhook-secret': 'per-zap-secret' }, triggerMeta)).toEqual({ ok: true });
  });

  it('allows capability-URL requests when neither trigger nor env secret is set, without using a default key', () => {
    delete process.env.WEBHOOK_SECRET;

    // The legacy implicit policy is one of the three audited open doors
    // (OPEN_WHEN_UNCONFIGURED in @repo/ingress); it keeps its behaviour here.
    expect(check({})).toEqual({ ok: true });
    expect(verifyLegacyWebhook(rawBody, 'sha256=anything', undefined)).toMatchObject({
      ok: false,
      code: 'SECRET_NOT_CONFIGURED',
    });
  });

  it('refuses an explicitly-selected auth mode that has no secret', () => {
    delete process.env.WEBHOOK_SECRET;

    expect(check({ 'x-webhook-secret': 'anything' }, { authMode: 'static' })).toMatchObject({
      ok: false,
      code: 'SECRET_NOT_CONFIGURED',
      status: 401,
    });
    expect(check({ 'x-webhook-signature': 'sha256=anything' }, { authMode: 'hmac' })).toMatchObject(
      {
        ok: false,
        code: 'SECRET_NOT_CONFIGURED',
        status: 403,
      }
    );
  });

  it('opens an authMode none hook by design', () => {
    delete process.env.WEBHOOK_SECRET;

    expect(check({}, { authMode: 'none' })).toEqual({ ok: true });
  });
});
