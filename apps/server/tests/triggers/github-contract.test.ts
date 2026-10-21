import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import GitHubRouter, {
  buildGithubRunPayload,
  matchesRefFilter,
  PUSH_COMMIT_CAP,
} from '../../src/routes/GitHubRoutes';

/**
 * T4 contract tests — docs/ask-matt/triggers/github.md (round 6):
 * qualified event + slices + deliveryId + raw, push granularity (one run,
 * commits[] cap 20 with true commitCount), branch filter, dedupe key.
 */

const app = express();
app.use(express.json());
app.use('/api/github', GitHubRouter);

const SECRET = 'github-secret';

const issueOpenedPayload = {
  action: 'opened',
  issue: {
    number: 7,
    title: 'Login broken',
    body: 'Steps to repro…',
    state: 'open',
    labels: [{ name: 'bug' }, 'urgent'],
    html_url: 'https://github.com/acme/zapier/issues/7',
    user: { login: 'ada' },
  },
  repository: {
    name: 'zapier',
    full_name: 'acme/zapier',
    html_url: 'https://github.com/acme/zapier',
    private: true,
    default_branch: 'main',
  },
  sender: { login: 'octocat', id: 1, avatar_url: 'https://a/1.png', html_url: 'https://github.com/octocat' },
};

const prOpenedPayload = {
  action: 'opened',
  pull_request: {
    number: 8,
    title: 'Add feature',
    state: 'open',
    draft: false,
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feat/x' },
    html_url: 'https://github.com/acme/zapier/pull/8',
    body: 'PR body',
    user: { login: 'ada' },
  },
  repository: issueOpenedPayload.repository,
  sender: issueOpenedPayload.sender,
};

const makePushPayload = (commitCount: number) => ({
  ref: 'refs/heads/main',
  before: 'a'.repeat(40),
  after: 'b'.repeat(40),
  size: commitCount,
  commits: Array.from({ length: commitCount }, (_, i) => ({
    id: `c${i}`,
    message: `commit ${i}`,
    author: { name: `dev${i}`, email: `d${i}@x.io` },
    url: `https://github.com/acme/zapier/commit/c${i}`,
  })),
  head_commit: { message: `commit ${commitCount - 1}`, author: { name: 'dev' }, url: 'https://…' },
  pusher: { name: 'ada', email: 'ada@x.io' },
  repository: issueOpenedPayload.repository,
  sender: issueOpenedPayload.sender,
});

const sign = (secret: string, body: object) =>
  `sha256=${crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;

const postWebhook = (
  event: string,
  payload: object,
  headers: Record<string, string> = {}
) => {
  const req = request(app)
    .post('/api/github/webhook/zap-1')
    .set('x-github-event', event)
    .set('x-hub-signature-256', sign(SECRET, payload));
  for (const [key, value] of Object.entries(headers)) req.set(key, value);
  return req.send(payload);
};

let triggerMetadata: any = {};

beforeEach(() => {
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1', dispatched: true });
  triggerMetadata = {};
  (client.zap.findUnique as jest.Mock).mockResolvedValue({ id: 'zap-1', isActive: true });
  (client.trigger.findUnique as jest.Mock).mockImplementation(async () => ({
    triggerId: 'trigger-1',
    metadata: triggerMetadata,
  }));
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Issue' });
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
});

describe('T4 contract (§4)', () => {
  it('issue opened → one run with qualified event, issue slice, deliveryId and raw', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Issue' });
    const response = await postWebhook('issues', issueOpenedPayload, {
      'x-github-delivery': 'delivery-1',
    });

    expect(response.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const input = mockEnqueueRun.mock.calls[0][0];
    expect(input.metadata).toMatchObject({
      event: 'issues.opened',
      deliveryId: 'delivery-1',
      repository: {
        fullName: 'acme/zapier',
        htmlUrl: 'https://github.com/acme/zapier',
        private: true,
        defaultBranch: 'main',
        full_name: 'acme/zapier', // legacy alias
      },
      sender: { login: 'octocat', id: 1, avatarUrl: 'https://a/1.png' },
      issue: {
        number: 7,
        title: 'Login broken',
        state: 'open',
        labels: ['bug', 'urgent'],
        htmlUrl: 'https://github.com/acme/zapier/issues/7',
      },
      raw: issueOpenedPayload,
    });
    expect(input.dedup).toEqual({ scope: 'github', key: 'zap-1:delivery-1' });
  });

  it('pull_request opened → pr slice with draft/base/head/merged', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({
      type: 'GitHub Pull Request',
    });
    await postWebhook('pull_request', prOpenedPayload, { 'x-github-delivery': 'delivery-2' });

    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.event).toBe('pull_request.opened');
    expect(metadata.pull_request).toMatchObject({
      number: 8,
      title: 'Add feature',
      draft: false,
      base: 'main',
      head: 'feat/x',
      merged: false,
      htmlUrl: 'https://github.com/acme/zapier/pull/8',
    });
    expect(metadata.issue).toBeUndefined();
    expect(metadata.push).toBeUndefined();
  });

  it('push of 25 commits with no filter → one run, commits[] capped at 20, commitCount true total', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Push' });
    const payload = makePushPayload(25);
    const response = await postWebhook('push', payload, { 'x-github-delivery': 'delivery-3' });

    expect(response.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.event).toBe('push');
    expect(metadata.push.commits).toHaveLength(PUSH_COMMIT_CAP);
    expect(metadata.push.commitCount).toBe(25);
    expect(metadata.push.headCommitMessage).toBe('commit 24');
    expect(metadata.push.branch).toBe('main');
    // legacy aliases
    expect(metadata.branch).toBe('main');
    expect(metadata.commits).toBe(25);
  });

  it('same delivery id redelivered → duplicate skipped, zero extra runs', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Issue' });
    mockEnqueueRun.mockResolvedValueOnce({ status: 'duplicate' });

    const response = await postWebhook('issues', issueOpenedPayload, {
      'x-github-delivery': 'delivery-dup',
    });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/duplicate/i);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1); // called once; intake deduped it
  });
});

describe('T4 ref filter (§5, Q-GH-05)', () => {
  it('push to a non-matching branch with filter set → no run', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Push' });
    triggerMetadata = { branchFilter: 'main,release' };
    const payload = { ...makePushPayload(1), ref: 'refs/heads/develop' };

    const response = await postWebhook('push', payload, { 'x-github-delivery': 'delivery-4' });

    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/filtered/i);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('no filter configured → every branch fires (no default restriction)', async () => {
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Push' });
    const payload = { ...makePushPayload(1), ref: 'refs/heads/experimental' };

    await postWebhook('push', payload, { 'x-github-delivery': 'delivery-5' });

    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('matchesRefFilter handles arrays, comma lists, tags and empty config', () => {
    expect(matchesRefFilter('refs/heads/main', {})).toBe(true);
    expect(matchesRefFilter('refs/heads/dev', { branchFilter: 'main' })).toBe(false);
    expect(matchesRefFilter('refs/heads/main', { branchFilter: 'main, release' })).toBe(true);
    expect(matchesRefFilter('refs/heads/a', { branchFilter: ['b'] })).toBe(false);
    expect(matchesRefFilter('refs/tags/v1.0', { tagFilter: 'v1.0' })).toBe(true);
    expect(matchesRefFilter('refs/tags/v2.0', { tagFilter: 'v1.0' })).toBe(false);
  });
});

describe('T4 per-zap secret (config UI saved)', () => {
  it('verifies against Trigger.metadata.webhookSecret when env secret is unset', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({ type: 'GitHub Issue' });
    triggerMetadata = { webhookSecret: 'zap-secret' };

    const rejected = await request(app)
      .post('/api/github/webhook/zap-1')
      .set('x-github-event', 'issues')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(issueOpenedPayload);
    expect(rejected.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();

    const accepted = await request(app)
      .post('/api/github/webhook/zap-1')
      .set('x-github-event', 'issues')
      .set('x-hub-signature-256', sign('zap-secret', issueOpenedPayload))
      .send(issueOpenedPayload);
    expect(accepted.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });
});

describe('buildGithubRunPayload pure slices', () => {
  it('release keeps the legacy beyond-spec slice working', () => {
    const data = buildGithubRunPayload(
      'release',
      { action: 'published', release: { tag_name: 'v1', name: 'One', html_url: 'u', prerelease: false } },
      'd1'
    );
    expect(data.event).toBe('release.published');
    expect(data.release).toMatchObject({ tag_name: 'v1', prerelease: false });
  });

  it('event stays unqualified when the payload has no action (push)', () => {
    const data = buildGithubRunPayload('push', { ref: 'refs/heads/main' }, 'd2');
    expect(data.event).toBe('push');
    expect(data.deliveryId).toBe('d2');
    expect(data.raw).toEqual({ ref: 'refs/heads/main' });
  });
});
