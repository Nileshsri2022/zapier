import { Request, Response } from 'express';
import client from '@repo/db';
import * as ZapController from '../../src/controllers/ZapController';
import * as ActionsController from '../../src/controllers/ActionsController';
import * as TriggerController from '../../src/controllers/TriggerController';

jest.mock('../../src/controllers/ActionsController');

/**
 * A run whose actions failed must not be recorded as a success.
 * Before this, per-action errors were swallowed and zapRun.create was called
 * without a status, so a Zap where every step failed still looked healthy.
 */

const mockedExecuteAction = ActionsController.executeAction as jest.MockedFunction<
  typeof ActionsController.executeAction
>;

const zapWith = (actions: { type: string }[]) => ({
  id: 'zap-123',
  actions: actions.map((a, i) => ({
    action: { type: a.type },
    metadata: { step: i + 1 },
    sortingOrder: i + 1,
  })),
});

const lastRunRecord = () => {
  const create = client.zapRun.create as jest.Mock;
  expect(create).toHaveBeenCalled();
  return create.mock.calls[create.mock.calls.length - 1][0].data;
};

const webhookRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

describe('ZapController - run status is recorded honestly', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processWebhookTrigger', () => {
    it('records completed when every action succeeds', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(zapWith([{ type: 'Email' }]));
      mockedExecuteAction.mockResolvedValue(undefined);

      await ZapController.processWebhookTrigger('zap-123', { event: 'test' });

      const run = lastRunRecord();
      expect(run.status).toBe('completed');
      expect(run.errorMessage).toBeNull();
      expect(run.completedAt).toBeInstanceOf(Date);
    });

    it('records failed and names the action when one throws', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(
        zapWith([{ type: 'Email' }, { type: 'Solana' }])
      );
      mockedExecuteAction
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('insufficient funds'));

      await ZapController.processWebhookTrigger('zap-123', { event: 'test' });

      const run = lastRunRecord();
      expect(run.status).toBe('failed');
      expect(run.errorMessage).toContain('Solana');
      expect(run.errorMessage).toContain('insufficient funds');
    });

    it('records failed when every action throws', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(zapWith([{ type: 'Email' }]));
      mockedExecuteAction.mockRejectedValue(new Error('smtp down'));

      await ZapController.processWebhookTrigger('zap-123', { event: 'test' });

      expect(lastRunRecord().status).toBe('failed');
    });

    it('keeps executing later actions after one fails', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(
        zapWith([{ type: 'Email' }, { type: 'Solana' }])
      );
      mockedExecuteAction
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);

      await ZapController.processWebhookTrigger('zap-123', { event: 'test' });

      expect(mockedExecuteAction).toHaveBeenCalledTimes(2);
      expect(lastRunRecord().status).toBe('failed');
    });

    it('does not throw, so webhook providers do not retry and double-run', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(zapWith([{ type: 'Email' }]));
      mockedExecuteAction.mockRejectedValue(new Error('smtp down'));

      await expect(
        ZapController.processWebhookTrigger('zap-123', { event: 'test' })
      ).resolves.toBeUndefined();
    });

    it('writes no run when the zap is missing or inactive', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(null);

      await ZapController.processWebhookTrigger('zap-123', { event: 'test' });

      expect(client.zapRun.create).not.toHaveBeenCalled();
    });
  });

  // Renamed from processGmailTrigger in gmail-worker-routing-spec P2 (the old
  // name collided with GmailTriggersController's fan-out); this legacy inline
  // executor is deleted in P5, at which point these suites are re-pinned to
  // enqueue semantics per the spec's test plan.
  describe('executeGmailZapInline (legacy)', () => {
    it('records failed when an action throws', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(zapWith([{ type: 'GmailSend' }]));
      mockedExecuteAction.mockRejectedValue(new Error('gmail quota exceeded'));

      await ZapController.executeGmailZapInline('zap-123', { messageId: 'm1' });

      const run = lastRunRecord();
      expect(run.status).toBe('failed');
      expect(run.errorMessage).toContain('gmail quota exceeded');
    });
  });

  describe('webhook response is unchanged', () => {
    it('still returns 200 with a failed action, so providers do not retry and double-run', async () => {
      (client.zap.findUnique as jest.Mock).mockResolvedValue(zapWith([{ type: 'Email' }]));
      mockedExecuteAction.mockRejectedValue(new Error('boom'));

      const { res, status } = webhookRes();
      await TriggerController.handleWebhook(
        {
          params: { zapId: 'zap-123' },
          body: { event: 'test' },
          headers: {},
        } as unknown as Request,
        res
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(lastRunRecord().status).toBe('failed');
    });
  });
});
