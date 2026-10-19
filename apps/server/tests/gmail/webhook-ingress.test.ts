import { Request, Response } from 'express';
import crypto from 'crypto';
import client from '@repo/db';

/**
 * Gmail webhook ingress (reports/gmail-worker-routing-spec.md P3):
 * - real Pub/Sub shape {emailAddress, historyId} behind OIDC auth,
 * - legacy custom-relay shape {eventType, messageId} behind HMAC,
 * - fail-closed everywhere else.
 * GmailService and google-auth-library are mocked — no Google calls.
 */

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const mockGetEmailMetadata = jest.fn();
const mockGetEmailContent = jest.fn();
const mockListHistory = jest.fn();
jest.mock('../../src/services/GmailService', () => ({
  GmailService: jest.fn().mockImplementation(() => ({
    getEmailMetadata: mockGetEmailMetadata,
    getEmailContent: mockGetEmailContent,
    listHistory: mockListHistory,
  })),
}));

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import { handleGmailWebhook } from '../../src/controllers/GmailWebhookController';

const PUSH_ACCOUNT = 'gmail-push@test-project.iam.gserviceaccount.com';

const encode = (data: any) => Buffer.from(JSON.stringify(data)).toString('base64');
const envelope = (data: any) => ({
  message: { data: encode(data), messageId: 'pubsub-1', publishTime: '2026-10-19T00:00:00Z' },
  subscription: 'projects/test/subscriptions/gmail',
});

const reqRes = (body: any, headers: Record<string, string> = {}) => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    req: { body, headers } as unknown as Request,
    res: { status, json } as unknown as Response,
    status,
    json,
  };
};

const serverRow = {
  id: 'server-1',
  clientId: 'c',
  clientSecret: 's',
  refreshToken: 'r',
  accessToken: 'a',
  tokenExpiry: null,
  isActive: true,
  email: 'owner@gmail.com',
  lastHistoryId: '100',
};

describe('handleGmailWebhook — Pub/Sub OIDC + history shape', () => {
  beforeEach(() => {
    mockEnqueueRun.mockReset();
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1', dispatched: true });
    process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT = PUSH_ACCOUNT;
    delete process.env.GMAIL_PUBSUB_AUDIENCE;

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: PUSH_ACCOUNT, email_verified: true }),
    });
    mockGetEmailMetadata.mockResolvedValue({
      id: 'msg-1',
      threadId: 't1',
      snippet: 's',
      from: 'A <a@example.com>',
      to: ['owner@gmail.com'],
      subject: 'Hello',
      date: new Date('2026-10-19T10:00:00.000Z'),
      labels: ['INBOX'],
      hasAttachments: false,
      isRead: false,
    });
    mockGetEmailContent.mockResolvedValue({ body: 'hello body', truncated: false });
    mockListHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);

    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([serverRow]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      {
        triggerType: 'new_email',
        watchedLabels: [],
        senderFilter: null,
        subjectFilter: null,
        metadata: {},
        zap: { id: 'zap-1', isActive: true },
      },
    ]);
  });

  afterEach(() => {
    delete process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
    delete process.env.GMAIL_WEBHOOK_SECRET;
  });

  const historyReq = () =>
    reqRes(envelope({ emailAddress: 'owner@gmail.com', historyId: '150' }), {
      authorization: 'Bearer fake-jwt',
    });

  it('processes a real watch notification end to end (resolve by email → delta → outbox → cursor)', async () => {
    const { req, res, status } = historyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(client.gmailServer.findMany).toHaveBeenCalledWith({
      where: { email: 'owner@gmail.com', isActive: true },
    });
    expect(mockListHistory).toHaveBeenCalledWith('100');
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRun.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        zapId: 'zap-1',
        source: 'server.gmail',
        dedup: { scope: 'gmail', key: 'zap-1:msg-1:new_email' },
      })
    );
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('rejects when OIDC verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const { req, res, status } = historyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('rejects a verified token from the wrong service account', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ email: 'attacker@evil.example', email_verified: true }),
    });
    const { req, res, status } = historyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(401);
  });

  it('rejects requests with no credentials at all (fail closed)', async () => {
    const { req, res, status } = reqRes(
      envelope({ emailAddress: 'owner@gmail.com', historyId: '150' })
    );
    await handleGmailWebhook(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('acks 200 for a mailbox with no connected server (nothing to route to)', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([]);
    const { req, res, status } = historyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed envelope instead of 500-looping', async () => {
    const { req, res, status } = reqRes({ nope: true }, { authorization: 'Bearer fake-jwt' });
    await handleGmailWebhook(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('surfaces hydration failure as 500 so Pub/Sub redelivers (dedup makes it safe)', async () => {
    mockGetEmailMetadata.mockResolvedValue(null);
    const { req, res, status } = historyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(client.gmailServer.update).not.toHaveBeenCalled();
  });
});

describe('handleGmailWebhook — legacy custom-relay shape (HMAC)', () => {
  const SECRET = 'test-gmail-webhook-secret';

  beforeEach(() => {
    mockEnqueueRun.mockReset();
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1', dispatched: true });
    process.env.GMAIL_WEBHOOK_SECRET = SECRET;
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.GMAIL_WEBHOOK_SECRET;
  });

  const legacyReq = () => {
    const body = envelope({
      emailAddress: 'owner@gmail.com',
      historyId: '150',
      eventType: 'new_email',
      messageId: 'msg-1',
    });
    const signature = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    return reqRes(body, { 'x-goog-signature': signature });
  };

  it('accepts a correctly HMAC-signed legacy payload and dispatches via outbox (P5)', async () => {
    // Post-P5 the legacy shape takes the same single path as real Pub/Sub:
    // resolve server by email -> hydrate -> ZapRun + ZapRunOutbox.
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(null);
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([serverRow]);
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      {
        triggerType: 'new_email',
        watchedLabels: [],
        senderFilter: null,
        subjectFilter: null,
        metadata: {},
        zap: { id: 'zap-1', isActive: true },
      },
    ]);
    mockGetEmailMetadata.mockResolvedValue({
      id: 'msg-1',
      threadId: 't1',
      snippet: 's',
      from: 'A <a@example.com>',
      to: ['owner@gmail.com'],
      subject: 'Hello',
      date: new Date('2026-10-19T10:00:00.000Z'),
      labels: ['INBOX'],
      hasAttachments: false,
      isRead: false,
    });
    mockGetEmailContent.mockResolvedValue({ body: 'hello body', truncated: false });

    const { req, res, status } = legacyReq();
    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(client.gmailServer.findMany).toHaveBeenCalledWith({
      where: { email: 'owner@gmail.com', isActive: true },
    });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('rejects a legacy payload with a bad HMAC', async () => {
    const body = envelope({
      emailAddress: 'owner@gmail.com',
      historyId: '150',
      eventType: 'new_email',
      messageId: 'msg-1',
    });
    const { req, res, status } = reqRes(body, { 'x-goog-signature': 'deadbeef' });
    await handleGmailWebhook(req, res);
    expect(status).toHaveBeenCalledWith(401);
  });
});
