import { Request, Response } from 'express';
import client from '@repo/db';
import redis from '@repo/redis';
import { GoogleSheetsService } from '../../src/services/GoogleSheetsService';
import * as GoogleSheetsController from '../../src/controllers/GoogleSheetsController';
import * as GoogleSheetsTriggersController from '../../src/controllers/GoogleSheetsTriggersController';

jest.mock('@repo/redis', () => ({
  __esModule: true,
  default: {
    del: jest.fn().mockResolvedValue(1),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
}));

// Extend Express Request to include id from auth middleware
declare module 'express-serve-static-core' {
  interface Request {
    id?: string;
  }
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================
// GoogleSheetsController Tests
// ============================================

describe('GoogleSheetsController - Get Servers', () => {
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

  describe('getServers', () => {
    it('should return list of servers for authenticated user', async () => {
      mockRequest = {
        id: '1' as any,
      };

      const mockServers = [
        { id: 'server-1', email: 'test@gmail.com', userId: 1 },
        { id: 'server-2', email: 'test2@gmail.com', userId: 1 },
      ];

      (client.googleSheetsServer.findMany as jest.Mock).mockResolvedValue(mockServers);

      await GoogleSheetsController.getServers(mockRequest as Request, mockResponse as Response);

      expect(client.googleSheetsServer.findMany).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
    });

    it('should return empty array when user has no servers', async () => {
      mockRequest = {
        id: '1' as any,
      };

      (client.googleSheetsServer.findMany as jest.Mock).mockResolvedValue([]);

      await GoogleSheetsController.getServers(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(200);
    });
  });
});

describe('GoogleSheetsController - Delete Server', () => {
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

  describe('deleteServer', () => {
    it('should return 404 if serverId is missing or server not found', async () => {
      mockRequest = {
        params: {},
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsController.deleteServer(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Server not found',
        })
      );
    });

    it('should return 404 if server not found', async () => {
      mockRequest = {
        params: { id: 'server-123' },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsController.deleteServer(mockRequest as Request, mockResponse as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Server not found',
        })
      );
    });
  });
});

// ============================================
// GoogleSheetsTriggersController Tests (Seam 2)
// ============================================

describe('GoogleSheetsTriggersController - Create Trigger', () => {
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

  describe('createTrigger', () => {
    it('should return 400 if required fields are missing', async () => {
      mockRequest = {
        body: {},
        id: '1' as any,
      };

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
    });

    it('should return 404 if server not found', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'Sheet1',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Server not found',
        })
      );
    });

    it('should return 404 if zap not found for user', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'Sheet1',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue({ id: 'server-123' });
      (client.zap.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Zap not found',
        })
      );
    });

    it('should return 400 if trigger already exists for this zap', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'Sheet1',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue({ id: 'server-123' });
      (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-123' });
      (client.googleSheetsTrigger.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-trigger',
      });

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger already exists for this Zap',
        })
      );
    });

    it('should return 400 if spreadsheet access validation fails', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'Sheet1',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue({
        id: 'server-123',
        refreshToken: 'fake-refresh',
        accessToken: 'fake-access',
      });
      (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-123' });
      (client.googleSheetsTrigger.findUnique as jest.Mock).mockResolvedValue(null);
      jest.spyOn(GoogleSheetsService.prototype, 'validateAccess').mockResolvedValue(false);

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Cannot access spreadsheet. Make sure it is shared with your Google account.',
        })
      );
    });

    it('should create trigger successfully and seed initial row hashes', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'CustomSheet',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue({
        id: 'server-123',
        refreshToken: 'fake-refresh',
        accessToken: 'fake-access',
      });
      (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-123' });
      (client.googleSheetsTrigger.findUnique as jest.Mock).mockResolvedValue(null);
      jest.spyOn(GoogleSheetsService.prototype, 'validateAccess').mockResolvedValue(true);
      const pollSpy = jest
        .spyOn(GoogleSheetsService.prototype, 'pollForUpdates')
        .mockResolvedValue([]);

      const createdTrigger = {
        id: 'new-trigger-1',
        serverId: 'server-123',
        zapId: 'zap-123',
        spreadsheetId: 'sheet-123',
        sheetName: 'CustomSheet',
        isActive: true,
      };
      (client.googleSheetsTrigger.create as jest.Mock).mockResolvedValue(createdTrigger);

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.googleSheetsTrigger.create).toHaveBeenCalledWith({
        data: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
          sheetName: 'CustomSheet',
          isActive: true,
        },
      });
      expect(pollSpy).toHaveBeenCalledWith('new-trigger-1', 'sheet-123', 'CustomSheet');
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Google Sheets trigger created successfully',
          trigger: expect.objectContaining({
            id: 'new-trigger-1',
            spreadsheetId: 'sheet-123',
            sheetName: 'CustomSheet',
            isActive: true,
          }),
        })
      );
    });

    it('should create trigger successfully even if initial pollForUpdates seeding throws', async () => {
      mockRequest = {
        body: {
          serverId: 'server-123',
          zapId: 'zap-123',
          spreadsheetId: 'sheet-123',
        },
        id: '1' as any,
      };

      (client.googleSheetsServer.findFirst as jest.Mock).mockResolvedValue({
        id: 'server-123',
        refreshToken: 'fake-refresh',
        accessToken: 'fake-access',
      });
      (client.zap.findFirst as jest.Mock).mockResolvedValue({ id: 'zap-123' });
      (client.googleSheetsTrigger.findUnique as jest.Mock).mockResolvedValue(null);
      jest.spyOn(GoogleSheetsService.prototype, 'validateAccess').mockResolvedValue(true);
      jest
        .spyOn(GoogleSheetsService.prototype, 'pollForUpdates')
        .mockRejectedValue(new Error('Sheets temporary error'));

      const createdTrigger = {
        id: 'new-trigger-2',
        serverId: 'server-123',
        zapId: 'zap-123',
        spreadsheetId: 'sheet-123',
        sheetName: 'Sheet1',
        isActive: true,
      };
      (client.googleSheetsTrigger.create as jest.Mock).mockResolvedValue(createdTrigger);

      await GoogleSheetsTriggersController.createTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Google Sheets trigger created successfully',
        })
      );
    });
  });
});

// ============================================
// GoogleSheetsTriggersController - Get Triggers
// ============================================

describe('GoogleSheetsTriggersController - Get Triggers', () => {
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

  describe('getTriggers', () => {
    it('should return triggers for user', async () => {
      mockRequest = {
        query: {},
        id: '1' as any,
      };

      const mockTriggers = [
        { id: 'trigger-1', spreadsheetId: 'sheet-1' },
        { id: 'trigger-2', spreadsheetId: 'sheet-2' },
      ];

      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue(mockTriggers);

      await GoogleSheetsTriggersController.getTriggers(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          triggers: mockTriggers,
        })
      );
    });

    it('should call findMany with serverId when filtering by server', async () => {
      mockRequest = {
        query: { serverId: 'server-123' },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([]);

      await GoogleSheetsTriggersController.getTriggers(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.googleSheetsTrigger.findMany).toHaveBeenCalledWith({
        where: {
          server: {
            userId: 1,
            isActive: true,
            id: 'server-123',
          },
        },
        include: {
          zap: {
            select: { id: true, name: true, isActive: true },
          },
          server: {
            select: { id: true, name: true, email: true },
          },
        },
      });
    });
  });
});

// ============================================
// GoogleSheetsTriggersController - Update Trigger
// ============================================

describe('GoogleSheetsTriggersController - Update Trigger', () => {
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

  describe('updateTrigger', () => {
    it('should return 400 if triggerId is missing', async () => {
      mockRequest = {
        params: {},
        body: { sheetName: 'NewSheet' },
        id: '1' as any,
      };

      await GoogleSheetsTriggersController.updateTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger ID is required',
        })
      );
    });

    it('should return 404 if trigger not found', async () => {
      mockRequest = {
        params: { triggerId: 'trigger-123' },
        body: { sheetName: 'NewSheet' },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsTriggersController.updateTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger not found',
        })
      );
    });

    it('should update trigger and invalidate Redis row hashes when spreadsheetId changes', async () => {
      mockRequest = {
        params: { triggerId: 'trigger-123' },
        body: { spreadsheetId: 'new-sheet-456' },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
        serverId: 'server-1',
      });
      (client.googleSheetsTrigger.update as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
        spreadsheetId: 'new-sheet-456',
        sheetName: 'Sheet1',
      });

      await GoogleSheetsTriggersController.updateTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.googleSheetsTrigger.update).toHaveBeenCalledWith({
        where: { id: 'trigger-123' },
        data: { spreadsheetId: 'new-sheet-456' },
      });
      expect(redis.del).toHaveBeenCalledWith('sheets:trigger:trigger-123:rowhash');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger updated successfully',
        })
      );
    });

    it('should update isActive status without clearing Redis hashes if sheet and spreadsheetId are unchanged', async () => {
      mockRequest = {
        params: { triggerId: 'trigger-123' },
        body: { isActive: false },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
        serverId: 'server-1',
      });
      (client.googleSheetsTrigger.update as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
        isActive: false,
      });

      await GoogleSheetsTriggersController.updateTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.googleSheetsTrigger.update).toHaveBeenCalledWith({
        where: { id: 'trigger-123' },
        data: { isActive: false },
      });
      expect(redis.del).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(200);
    });
  });
});

// ============================================
// GoogleSheetsTriggersController - Delete Trigger
// ============================================

describe('GoogleSheetsTriggersController - Delete Trigger', () => {
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

  describe('deleteTrigger', () => {
    it('should return 400 if triggerId is missing', async () => {
      mockRequest = {
        params: {},
        id: '1' as any,
      };

      await GoogleSheetsTriggersController.deleteTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger ID is required',
        })
      );
    });

    it('should return 404 if trigger not found', async () => {
      mockRequest = {
        params: { triggerId: 'trigger-123' },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue(null);

      await GoogleSheetsTriggersController.deleteTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger not found',
        })
      );
    });

    it('should delete trigger from database and delete Redis row hash store', async () => {
      mockRequest = {
        params: { triggerId: 'trigger-123' },
        id: '1' as any,
      };

      (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
        serverId: 'server-1',
      });
      (client.googleSheetsTrigger.delete as jest.Mock).mockResolvedValue({
        id: 'trigger-123',
      });

      await GoogleSheetsTriggersController.deleteTrigger(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(client.googleSheetsTrigger.delete).toHaveBeenCalledWith({
        where: { id: 'trigger-123' },
      });
      expect(redis.del).toHaveBeenCalledWith('sheets:trigger:trigger-123:rowhash');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Trigger deleted successfully',
        })
      );
    });
  });
});
