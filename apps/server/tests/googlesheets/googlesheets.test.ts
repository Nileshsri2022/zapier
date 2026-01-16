import { Request, Response } from 'express';
import client from '@repo/db';
import * as GoogleSheetsController from '../../src/controllers/GoogleSheetsController';
import * as GoogleSheetsTriggersController from '../../src/controllers/GoogleSheetsTriggersController';

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
                { id: 'server-2', email: 'test2@gmail.com', userId: 1 }
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
                    message: 'Server not found'
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
                    message: 'Server not found'
                })
            );
        });
    });
});

// ============================================
// GoogleSheetsTriggersController Tests
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

            await GoogleSheetsTriggersController.createTrigger(mockRequest as Request, mockResponse as Response);

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

            await GoogleSheetsTriggersController.createTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Server not found'
                })
            );
        });
    });
});

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

            await GoogleSheetsTriggersController.getTriggers(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    triggers: mockTriggers
                })
            );
        });

        it('should call findMany when fetching triggers', async () => {
            mockRequest = {
                query: { serverId: 'server-123' },
                id: '1' as any,
            };

            (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([]);

            await GoogleSheetsTriggersController.getTriggers(mockRequest as Request, mockResponse as Response);

            expect(client.googleSheetsTrigger.findMany).toHaveBeenCalled();
        });
    });
});

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

            await GoogleSheetsTriggersController.updateTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Trigger ID is required'
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

            await GoogleSheetsTriggersController.updateTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Trigger not found'
                })
            );
        });
    });
});

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

            await GoogleSheetsTriggersController.deleteTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Trigger ID is required'
                })
            );
        });

        it('should return 404 if trigger not found', async () => {
            mockRequest = {
                params: { triggerId: 'trigger-123' },
                id: '1' as any,
            };

            (client.googleSheetsTrigger.findFirst as jest.Mock).mockResolvedValue(null);

            await GoogleSheetsTriggersController.deleteTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Trigger not found'
                })
            );
        });
    });
});
