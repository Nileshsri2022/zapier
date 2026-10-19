/**
 * BUG: the GitHub webhook ignores `x-github-delivery` and calls `enqueueRun`
 * without a dedup key. GitHub retries deliveries (and can deliver the same
 * event twice), so every redelivery fans out into another ZapRun — the Zap's
 * actions run twice for one push.
 *
 * Expected (green): the same delivery id enqueues at most one run.
 */
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import client from '@repo/db';

const SECRET = 'github-webhook-secret-for-repro';
process.env.GITHUB_WEBHOOK_SECRET = SECRET;

jest.mock('@repo/runs', () => ({
  __esModule: true,
  enqueueRun: jest.fn().mockResolvedValue({ status: 'queued', zapRunId: 'run-1' }),
}));

import { enqueueRun } from '@repo/runs';
import GitHubRouter from '../../apps/server/src/routes/GitHubRoutes';

const app = express();
// Mirror apps/server/src/index.ts: capture the raw bytes for signature checks.
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = Buffer.from(buf);
    },
  })
);
app.use('/api/github', GitHubRouter);

const ZAP_ID = 'zap-github-1';
const PAYLOAD = JSON.stringify({
  ref: 'refs/heads/main',
  repository: { full_name: 'acme/widgets' },
  sender: { login: 'octocat' },
  commits: [{ id: 'abc123' }],
});

const signatureFor = (body: string) =>
  `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;

const postDelivery = (deliveryId: string) =>
  request(app)
    .post(`/api/github/webhook/${ZAP_ID}`)
    .set('Content-Type', 'application/json')
    .set('x-github-event', 'push')
    .set('x-github-delivery', deliveryId)
    .set('x-hub-signature-256', signatureFor(PAYLOAD))
    .send(PAYLOAD);

beforeEach(() => {
  jest.clearAllMocks();
  (client.zap.findUnique as jest.Mock).mockResolvedValue({ id: ZAP_ID, isActive: true });
  (client.trigger.findUnique as jest.Mock).mockResolvedValue({
    id: 'trigger-1',
    zapId: ZAP_ID,
    triggerId: 'available-github-push',
  });
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({
    id: 'available-github-push',
    type: 'GitHub Push',
  });
  (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
});

describe('GitHub webhook delivery idempotency', () => {
  it('enqueues one run per delivery id, even when GitHub redelivers', async () => {
    const deliveryId = '9a7b6c5d-1111-2222-3333-444455556666';

    const first = await postDelivery(deliveryId);
    const second = await postDelivery(deliveryId); // GitHub retry of the same delivery

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it('still enqueues a distinct run for a genuinely different delivery', async () => {
    await postDelivery('delivery-a');
    await postDelivery('delivery-b');

    expect(enqueueRun).toHaveBeenCalledTimes(2);
  });
});
