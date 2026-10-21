import { Request, Response } from 'express';
import client from '@repo/db';
import * as ActionsController from '../../src/controllers/ActionsController';
import { ACTION_CATALOG, findAction, offeredActionTypes } from '@repo/actions';
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

    it('returns Discord Send Message with correct image asset and catalog entry schema when present in database', async () => {
      mockRequest = {};
      const mockActions = [
        {
          id: 'discord-action-id',
          type: 'Discord Send Message',
          name: 'Discord',
          image: '/apps/discord.svg',
        },
      ];

      (client.availableActions.findMany as jest.Mock).mockResolvedValue(mockActions);

      await ActionsController.fetchAvailableActions(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        availableActions: expect.arrayContaining([
          expect.objectContaining({
            id: 'discord-action-id',
            type: 'Discord Send Message',
            image: '/apps/discord.svg',
          }),
        ]),
      }));
    });
  });
});

// The inline executeAction suite was removed in gmail-worker-routing P5:
// ActionsController now only serves the catalog; execution lives in apps/worker
// (guarded by worker tests/actionRegistry.test.ts).

describe('Seed Catalog - F4 / Gap D2 alignment', () => {
  it('seeds exactly the offered catalog, including AI Transform', () => {
    expect(SEEDED_ACTION_TYPES).toHaveLength(7);
    expect(SEEDED_ACTION_TYPES).toEqual(offeredActionTypes());
  });

  it('never seeds an alias — one action is one card in the picker', () => {
    for (const entry of ACTION_CATALOG.filter((candidate) => candidate.aliasOf)) {
      expect(SEEDED_ACTION_TYPES).not.toContain(entry.type);
    }
  });

  it('excludes unimplemented Gmail actions from both the catalog and the seed', () => {
    for (const gmailAction of UNIMPLEMENTED_GMAIL_ACTIONS) {
      expect(SEEDED_ACTION_TYPES).not.toContain(gmailAction);
      // The removal list and the action catalog must stay disjoint: a catalog
      // entry listed here would be seeded and then immediately pruned.
      expect(findAction(gmailAction)).toBeUndefined();
    }
    expect(SEEDED_ACTION_TYPES).toEqual([
      'AI Transform',
      'Email',
      'Solana',
      'WhatsApp Send Message',
      'Telegram Send Message',
      'Discord Send Message',
      'Webhook',
    ]);
  });

  it('prunes unreferenced Gmail actions and deactivates armed Zaps referencing them', async () => {
    (client.availableTriggers.createMany as jest.Mock).mockResolvedValue({ count: 23 });
    (client.availableActions.createMany as jest.Mock).mockResolvedValue({ count: 6 });
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
