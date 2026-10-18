import { Request, Response } from 'express';
import crypto from 'crypto';
import client from '@repo/db';
import * as TriggerController from '../../src/controllers/TriggerController';

/**
 * Enqueue semantics for the legacy server webhook (gmail-worker-routing
 * P5). This file previously pinned the server-inline executor writing
 * final run statuses itself. The honest-status intent carries over:
 *
 * - a delivered webhook durably creates ZapRun + ZapRunOutbox in ONE
 *   transaction — the run exists and is visible as `pending`; its final
 *   status is owned by apps/worker (running -> completed/failed), never
 *   pre-written here;
 * - the HTTP response stays 200 once queued (providers must not retry
 *   and double-run), including for missing/inactive Zaps (no rows);
 * - nothing is enqueued for bad signatures, and duplicate event ids
 *   (opt-in, hooks-ingress parity) enqueue only once.
 */

const mockDedupSeen = new Set<string>();
jest.mock('../../src/utils/dedup', () => ({
  isDuplicateEvent: jest.fn(async (scope: string, eventId?: string) => {
    if (!eventId) return false;
    const key = `${scope}:${eventId}`;
    if (mockDedupSeen.has(key)) return true;
    mockDedupSeen.add(key);
    return false;
  }),
  dedupKey: (scope: string, eventId: string) => `zapmate:dedup:${scope}:${eventId}`,
}));

const webhookRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const webhookReq = (body: any, headers: Record<string, string> = {}) =>
  ({ params: { zapId: 'zap-123' }, body, headers }) as unknown as Request;

describe('TriggerController.handleWebhook — enqueue, never execute', () => {
  beforeEach(() => {
    mockDedupSeen.clear();
    delete process.env.WEBHOOK_SECRET;
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(client));
    (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-1' });
    (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({ id: 'out-1' });
    (client.zap.findUnique as jest.Mock).mockResolvedValue({ id: 'zap-123' });
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  it('enqueues ZapRun + ZapRunOutbox in one transaction and returns 200', async () => {
    const { res, status } = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event: 'test', amount: 5 }), res);

    expect(status).toHaveBeenCalledWith(200);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    // No pre-written final status: the worker owns running/completed/failed.
    expect(client.zapRun.create).toHaveBeenCalledWith({
      data: { zapId: 'zap-123', metadata: { event: 'test', amount: 5 } },
    });
    expect(client.zapRunOutbox.create).toHaveBeenCalledWith({ data: { zapRunId: 'run-1' } });
  });

  it('writes no run when the zap is missing or inactive, but still returns 200', async () => {
    (client.zap.findUnique as jest.Mock).mockResolvedValue(null);
    const { res, status } = webhookRes();

    await TriggerController.handleWebhook(webhookReq({ event: 'test' }), res);

    expect(status).toHaveBeenCalledWith(200);
    expect(client.zapRun.create).not.toHaveBeenCalled();
    expect(client.zapRunOutbox.create).not.toHaveBeenCalled();
  });

  it('returns 400 without a zapId', async () => {
    const { res, status } = webhookRes();
    await TriggerController.handleWebhook(
      { params: {}, body: {}, headers: {} } as unknown as Request,
      res
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(client.zapRun.create).not.toHaveBeenCalled();
  });

  it('rejects missing/invalid signatures with 401 and enqueues nothing', async () => {
    process.env.WEBHOOK_SECRET = 'test-webhook-secret';

    const missing = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event: 'test' }), missing.res);
    expect(missing.status).toHaveBeenCalledWith(401);

    const invalid = webhookRes();
    await TriggerController.handleWebhook(
      webhookReq({ event: 'test' }, { 'x-webhook-signature': 'sha256=deadbeef' }),
      invalid.res
    );
    expect(invalid.status).toHaveBeenCalledWith(401);
    expect(client.zapRun.create).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed webhook when a secret is configured', async () => {
    process.env.WEBHOOK_SECRET = 'test-webhook-secret';
    const body = { event: 'signed' };
    const signature = `sha256=${crypto
      .createHmac('sha256', 'test-webhook-secret')
      .update(JSON.stringify(body))
      .digest('hex')}`;

    const { res, status } = webhookRes();
    await TriggerController.handleWebhook(
      webhookReq(body, { 'x-webhook-signature': signature }),
      res
    );

    expect(status).toHaveBeenCalledWith(200);
    expect(client.zapRun.create).toHaveBeenCalledTimes(1);
  });

  it('enqueues only once for a duplicate opt-in event_id', async () => {
    const first = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event_id: 'evt-1' }), first.res);
    const replay = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event_id: 'evt-1' }), replay.res);

    expect(first.status).toHaveBeenCalledWith(200);
    expect(replay.status).toHaveBeenCalledWith(200);
    expect(client.zapRun.create).toHaveBeenCalledTimes(1);
  });

  it('surfaces enqueue failures as 500 so the provider redelivers', async () => {
    (client.zapRun.create as jest.Mock).mockRejectedValue(new Error('db down'));
    const { res, status } = webhookRes();

    await TriggerController.handleWebhook(webhookReq({ event: 'test' }), res);
    expect(status).toHaveBeenCalledWith(500);
  });
});
