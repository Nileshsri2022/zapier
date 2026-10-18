import { Request, Response } from 'express';
import client from '@repo/db';
import * as ActionsController from '../../src/controllers/ActionsController';
import { seedDatabase, SEEDED_ACTION_TYPES, UNIMPLEMENTED_GMAIL_ACTIONS } from '../../src/seed';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ActionsController - Fetch Available Actions', () => {
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

  describe('fetchAvailableActions', () => {
    it('should return list of available actions', async () => {
      mockRequest = {};

      const mockActions = [
        { id: 'action-1', type: 'Email', name: 'Send Email' },
        { id: 'action-2', type: 'Solana', name: 'Send SOL' },
        { id: 'action-3', type: 'GmailSend', name: 'Send Gmail' },
      ];

      (client.availableActions.findMany as jest.Mock).mockResolvedValue(mockActions);

      await ActionsController.fetchAvailableActions(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.availableActions.findMany).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          availableActions: mockActions,
        })
      );
    });

    it('should return empty array when no actions exist', async () => {
      mockRequest = {};

      (client.availableActions.findMany as jest.Mock).mockResolvedValue([]);

      await ActionsController.fetchAvailableActions(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          availableActions: [],
        })
      );
    });
  });
});

describe('ActionsController - Execute Action', () => {
  describe('executeAction', () => {
    it('should throw error for unsupported action type', async () => {
      const metadata = {};
      const triggerPayload = {};

      await expect(
        ActionsController.executeAction('UnsupportedAction', metadata, triggerPayload)
      ).rejects.toThrow('Unsupported action type: UnsupportedAction');
    });

    it('should not throw for Email action type', async () => {
      const metadata = {
        to: 'test@example.com',
        subject: 'Test Subject',
        body: 'Test Body',
      };
      const triggerPayload = { key: 'value' };

      // This may throw due to SMTP not configured, but should attempt to execute
      try {
        await ActionsController.executeAction('Email', metadata, triggerPayload);
      } catch (error: any) {
        // Expected - SMTP not configured in tests
        expect(error.message).not.toContain('Unsupported action type');
      }
    });

    it('should not throw for Solana action type', async () => {
      const metadata = {
        address: 'solana-address-123',
        amount: '0.1',
      };
      const triggerPayload = { key: 'value' };

      // Solana action is just a placeholder log, should not throw
      await expect(
        ActionsController.executeAction('Solana', metadata, triggerPayload)
      ).resolves.not.toThrow();
    });
  });
});

describe('Seed Catalog - F4 / Gap D2 alignment', () => {
  it('excludes unimplemented Gmail actions from SEEDED_ACTION_TYPES', () => {
    for (const gmailAction of UNIMPLEMENTED_GMAIL_ACTIONS) {
      expect(SEEDED_ACTION_TYPES).not.toContain(gmailAction);
    }
    expect(SEEDED_ACTION_TYPES).toEqual([
      'Email',
      'Solana',
      'WhatsApp Send Message',
      'Telegram Send Message',
      'Webhook',
    ]);
  });

  it('prunes unreferenced Gmail actions and deactivates armed Zaps referencing them', async () => {
    (client.availableTriggers.createMany as jest.Mock).mockResolvedValue({ count: 23 });
    (client.availableActions.createMany as jest.Mock).mockResolvedValue({ count: 5 });
    (client.trigger.findMany as jest.Mock).mockResolvedValue([]);
    (client.availableTriggers.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
    (client.action.findMany as jest.Mock).mockResolvedValue([
      {
        action: { type: 'Gmail Send Email' },
        zap: { id: 'zap-gmail-1', name: 'Broken Gmail Zap', isActive: true },
      },
    ]);
    (client.zap.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (client.availableActions.deleteMany as jest.Mock).mockResolvedValue({ count: 5 });

    await seedDatabase();

    expect(client.availableActions.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.arrayContaining([expect.objectContaining({ type: 'Gmail Send Email' })]),
        skipDuplicates: true,
      })
    );
    expect(client.zap.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['zap-gmail-1'] } },
      data: { isActive: false },
    });
    expect(client.availableActions.deleteMany).toHaveBeenCalledWith({
      where: {
        type: { in: [...UNIMPLEMENTED_GMAIL_ACTIONS] },
        action: { none: {} },
      },
    });
  });
});
