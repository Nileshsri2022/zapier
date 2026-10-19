import { Request, Response } from 'express';
import crypto from 'crypto';
import * as TriggerController from '../../src/controllers/TriggerController';

/**
 * Contract between the legacy server webhook and the run-intake module.
 *
 * The module owns the durable part (active-Zap check, dedup claim, the
 * ZapRun + ZapRunOutbox transaction and the dispatch attempt). This file
 * pins what the HTTP seam must still guarantee:
 *
 * - the validated event is handed to intake with the same scope/key shape
 *   as the hooks ingress, so a delivery to both URLs fires only once;
 * - the response stays 200 once accepted, including when intake reports
 *   `duplicate` or `skipped` (missing/inactive Zap = no run);
 * - bad signatures and missing zap ids never reach intake;
 * - an intake failure surfaces as 500 so the provider redelivers.
 */

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

const queued = (zapRunId = 'run-1') => ({
  status: 'queued',
  zapRunId,
  dispatched: true,
});

const webhookRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const webhookReq = (body: any, headers: Record<string, string> = {}) =>
  ({ params: { zapId: 'zap-123' }, body, headers }) as unknown as Request;

describe('TriggerController.handleWebhook — intake, never execute', () => {
  beforeEach(() => {
    mockEnqueueRun.mockReset();
    mockEnqueueRun.mockResolvedValue(queued());
    delete process.env.WEBHOOK_SECRET;
  });

  afterEach(() => {
    delete process.env.WEBHOOK_SECRET;
  });

  it('hands the event to run intake and returns 200', async () => {
    const { res, status } = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event: 'test', amount: 5 }), res);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRun).toHaveBeenCalledWith({
      zapId: 'zap-123',
      metadata: { event: 'test', amount: 5 },
      source: 'server.webhook',
      dedup: { scope: 'webhook', key: undefined },
    });
  });

  it('returns 200 without a run when intake skips a missing or inactive Zap', async () => {
    mockEnqueueRun.mockResolvedValue({ status: 'skipped', reason: 'zap_inactive' });
    const { res, status, json } = webhookRes();

    await TriggerController.handleWebhook(webhookReq({ event: 'test' }), res);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Webhook processed successfully' })
    );
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('returns 400 without a zapId', async () => {
    const { res, status } = webhookRes();
    await TriggerController.handleWebhook(
      { params: {}, body: {}, headers: {} } as unknown as Request,
      res
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
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
    expect(mockEnqueueRun).not.toHaveBeenCalled();
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
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('uses one dedup identity for a replayed opt-in event_id', async () => {
    const first = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event_id: 'evt-1' }), first.res);
    const replay = webhookRes();
    await TriggerController.handleWebhook(webhookReq({ event_id: 'evt-1' }), replay.res);

    expect(mockEnqueueRun.mock.calls.map(([input]) => input.dedup)).toEqual([
      { scope: 'webhook', key: 'zap-123:evt-1' },
      { scope: 'webhook', key: 'zap-123:evt-1' },
    ]);
    expect(first.status).toHaveBeenCalledWith(200);
    expect(replay.status).toHaveBeenCalledWith(200);
  });

  it('surfaces intake failures as 500 so the provider redelivers', async () => {
    mockEnqueueRun.mockRejectedValue(new Error('db down'));
    const { res, status } = webhookRes();

    await TriggerController.handleWebhook(webhookReq({ event: 'test' }), res);
    expect(status).toHaveBeenCalledWith(500);
  });
});
