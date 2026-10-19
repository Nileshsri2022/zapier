import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import GitHubRouter from '../../src/routes/GitHubRoutes';

const app = express();
app.use(express.json());
app.use('/api/github', GitHubRouter);

const payload = {
  ref: 'refs/heads/main',
  repository: { name: 'zapier', full_name: 'acme/zapier', html_url: 'https://github.com/acme/zapier' },
  sender: { login: 'octocat', html_url: 'https://github.com/octocat' },
};

const sign = (secret: string, body: object) =>
  `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;

const postWebhook = (headers: Record<string, string> = {}) => {
  const req = request(app).post('/api/github/webhook/zap-1').set('x-github-event', 'push');
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send(payload);
};

const originalEnv = { ...process.env };

beforeEach(() => {
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1', dispatched: true });
  (client.zap.findUnique as jest.Mock).mockResolvedValue({
    id: 'zap-1',
    name: 'GitHub Zap',
    isActive: true,
  });
  (client.trigger.findUnique as jest.Mock).mockResolvedValue({ triggerId: 'trigger-1' });
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Push' });
  process.env.GITHUB_WEBHOOK_SECRET = 'github-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/github/webhook/:zapId — signature enforcement', () => {
  it('rejects a delivery with no signature when a secret is configured', async () => {
    const response = await postWebhook();

    expect(response.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('rejects a delivery with an invalid signature', async () => {
    const response = await postWebhook({
      'x-hub-signature-256': 'sha256=deadbeef',
    });

    expect(response.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('accepts a correctly signed delivery', async () => {
    const response = await postWebhook({
      'x-hub-signature-256': sign('github-secret', payload),
    });

    expect(response.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });
});
