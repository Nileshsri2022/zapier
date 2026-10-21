import { Request, Response } from 'express';
import crypto from 'crypto';
import client from '@repo/db';
import { verifyLegacyWebhook } from '@repo/ingress';
import * as TriggerController from '../../src/controllers/TriggerController';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('TriggerController - Fetch Available Triggers', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
  });

  describe('fetchAvailableTriggers', () => {
    it('should return list of available triggers', async () => {
      mockRequest = {};

      const mockTriggers = [
        { id: 'trigger-1', type: 'Webhook', name: 'Webhook Trigger' },
        { id: 'trigger-2', type: 'Gmail', name: 'Gmail Trigger' },
      ];

      (client.availableTriggers.findMany as jest.Mock).mockResolvedValue(mockTriggers);

      await TriggerController.fetchAvailableTriggers(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.availableTriggers.findMany).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          avialableTriggers: mockTriggers,
        })
      );
    });

    it('should return empty array when no triggers exist', async () => {
      mockRequest = {};

      (client.availableTriggers.findMany as jest.Mock).mockResolvedValue([]);

      await TriggerController.fetchAvailableTriggers(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          avialableTriggers: [],
        })
      );
    });
  });
});

describe('TriggerController - Handle Webhook', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
  });

  describe('handleWebhook', () => {
    it('should return 400 if zapId is missing', async () => {
      mockRequest = {
        params: {},
        body: { event: 'test' },
        headers: {},
      };

      await TriggerController.handleWebhook(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Zap ID is required',
        })
      );
    });

    it('should return 401 for invalid webhook signature when a secret is configured', async () => {
      // Signatures are only enforceable against a configured secret.
      // (Previously this passed by comparing against a hardcoded
      // 'default-secret' key in the source - see the audit report.)
      process.env.WEBHOOK_SECRET = 'test-webhook-secret';

      mockRequest = {
        params: { zapId: 'zap-123' },
        body: { event: 'test' },
        headers: { 'x-webhook-signature': 'invalid-signature' },
      };

      try {
        await TriggerController.handleWebhook(mockRequest as Request, mockResponse as Response);

        expect(statusMock).toHaveBeenCalledWith(401);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Invalid webhook signature',
          })
        );
      } finally {
        delete process.env.WEBHOOK_SECRET;
      }
    });
  });
});

// NOTE: the former "Handle Gmail Trigger" suite pinned TriggerController's
// handleGmailTrigger, which was exported but mounted on no route (dead
// code). It was deleted in gmail-worker-routing-spec P2; Gmail dispatch
// behavior is now covered by tests/gmail/dispatch.test.ts.

describe('TriggerController - Verify Webhook Signature', () => {
  // The verifier itself lives in @repo/ingress; this suite only pins how the
  // legacy endpoint wires it up.
  describe('verifyLegacyWebhook', () => {
    const payload = JSON.stringify({ event: 'test' });

    it('rejects an unknown signature', () => {
      const result = verifyLegacyWebhook(payload, 'some-signature', 'a-secret');
      expect(result).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL', status: 401 });
    });

    it('rejects invalid signature format', () => {
      expect(verifyLegacyWebhook(payload, 'completely-wrong', 'a-secret').ok).toBe(false);
    });

    it('accepts the digest the endpoint itself computes', () => {
      const signature = `sha256=${crypto
        .createHmac('sha256', 'a-secret')
        .update(payload)
        .digest('hex')}`;
      expect(verifyLegacyWebhook(payload, signature, 'a-secret')).toEqual({ ok: true });
    });
  });
});
