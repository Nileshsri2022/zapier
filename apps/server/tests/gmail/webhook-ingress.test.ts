import { Request, Response } from 'express';
import crypto from 'crypto';

/**
 * Gmail push ingress (controllers/GmailWebhookController.ts).
 *
 * This suite covers the wire contract only: authenticate, decode the Pub/Sub
 * envelope into a typed delivery, hand it to intake, answer 200/401/400/500.
 * Routing and hydration are covered in gmail/intake.test.ts — intake is mocked
 * here so a failure in it cannot be mistaken for an ingress bug.
 */

const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

const mockIntakeGmailDelivery = jest.fn();
jest.mock('../../src/services/gmailIntake', () => ({
  intakeGmailDelivery: (delivery: any) => mockIntakeGmailDelivery(delivery),
}));

import { handleGmailWebhook } from '../../src/controllers/GmailWebhookController';

const PUSH_ACCOUNT = 'gmail-push@test-project.iam.gserviceaccount.com';
const SECRET = 'test-gmail-webhook-secret';

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

const historyReq = () =>
  reqRes(envelope({ emailAddress: 'owner@gmail.com', historyId: '150' }), {
    authorization: 'Bearer fake-jwt',
  });

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  mockIntakeGmailDelivery.mockReset().mockResolvedValue({ runsEnqueued: 1 });
  process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT = PUSH_ACCOUNT;
  delete process.env.GMAIL_PUBSUB_AUDIENCE;
  mockVerifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: PUSH_ACCOUNT, email_verified: true }),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT;
  delete process.env.GMAIL_PUBSUB_AUDIENCE;
  delete process.env.GMAIL_WEBHOOK_SECRET;
});

describe('verify contract', () => {
  it('rejects when OIDC verification fails', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad token'));
    const { req, res, status } = historyReq();

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(mockIntakeGmailDelivery).not.toHaveBeenCalled();
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
    expect(mockIntakeGmailDelivery).not.toHaveBeenCalled();
  });

  it('rejects a legacy payload with a bad HMAC', async () => {
    process.env.GMAIL_WEBHOOK_SECRET = SECRET;
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

describe('Pub/Sub delivery decoding', () => {
  it('hands intake a pubsub delivery and acks 200', async () => {
    const { req, res, status } = historyReq();

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockIntakeGmailDelivery).toHaveBeenCalledWith({
      source: 'pubsub',
      emailAddress: 'owner@gmail.com',
      historyId: '150',
    });
  });

  it('returns 400 for a malformed envelope instead of 500-looping', async () => {
    const { req, res, status } = reqRes({ nope: true }, { authorization: 'Bearer fake-jwt' });

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockIntakeGmailDelivery).not.toHaveBeenCalled();
  });

  it('returns 400 for undecodable notification data', async () => {
    const body = {
      message: { data: 'not-json', messageId: 'p', publishTime: '2026-10-19T00:00:00Z' },
      subscription: 's',
    };
    const { req, res, status } = reqRes(body, { authorization: 'Bearer fake-jwt' });

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(mockIntakeGmailDelivery).not.toHaveBeenCalled();
  });

  it('acks 200 without routing a watch notification that carries no cursor', async () => {
    const { req, res, status } = reqRes(envelope({ emailAddress: 'owner@gmail.com' }), {
      authorization: 'Bearer fake-jwt',
    });

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockIntakeGmailDelivery).not.toHaveBeenCalled();
  });

  it('surfaces an intake failure as 500 so Pub/Sub redelivers (dedup makes it safe)', async () => {
    mockIntakeGmailDelivery.mockRejectedValue(new Error('Failed to hydrate Gmail message msg-1'));
    const { req, res, status } = historyReq();

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(500);
  });
});

describe('legacy custom-relay decoding (HMAC)', () => {
  const legacyReq = () => {
    const body = envelope({
      emailAddress: 'owner@gmail.com',
      historyId: '150',
      eventType: 'new_email',
      messageId: 'msg-1',
      threadId: 'thread-1',
    });
    // Q8/Q11: the relay signs the bytes it sends, and express hands those exact
    // bytes to the controller as `rawBody`. Signing a re-serialized body would
    // only match by luck.
    const rawBody = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', SECRET).update(rawBody).digest('hex');
    const prepared = reqRes(body, { 'x-goog-signature': signature });
    (prepared.req as any).rawBody = Buffer.from(rawBody);
    return prepared;
  };

  beforeEach(() => {
    process.env.GMAIL_WEBHOOK_SECRET = SECRET;
  });

  it('accepts a correctly HMAC-signed payload and hands intake a legacy delivery', async () => {
    const { req, res, status } = legacyReq();

    await handleGmailWebhook(req, res);

    expect(status).toHaveBeenCalledWith(200);
    expect(mockIntakeGmailDelivery).toHaveBeenCalledWith({
      source: 'legacy',
      emailAddress: 'owner@gmail.com',
      event: {
        eventType: 'new_email',
        messageId: 'msg-1',
        threadId: 'thread-1',
      },
    });
  });
});
