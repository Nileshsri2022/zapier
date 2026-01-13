import { Request, Response } from 'express';
import client from '@repo/db';
import * as ZapController from '../../src/controllers/ZapController';

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

describe('ZapController - Create Zap', () => {
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

    describe('createZap', () => {
        it('should create a new zap with valid data', async () => {
            mockRequest = {
                body: {
                    availableTriggerId: 'trigger-123',
                    triggerMetaData: { key: 'value' },
                    actions: [
                        { availableActionId: 'action-123', actionMetaData: { to: 'test@example.com' } }
                    ]
                },
                // @ts-ignore - userId is added by auth middleware
                userId: 'user-123'
            };

            const mockZap = {
                id: 'zap-123',
                userId: 'user-123',
                triggerId: 'trigger-id-123',
                actions: [{ id: 'action-id-123' }]
            };

            (client.$transaction as jest.Mock).mockImplementation(async (callback) => {
                return mockZap;
            });

            await ZapController.createZap(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(201);
        });

        it('should return 400 for invalid zap data', async () => {
            mockRequest = {
                body: {},
                // @ts-ignore
                userId: 'user-123'
            };

            await ZapController.createZap(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
        });

        it('should return 401 if userId is not present', async () => {
            mockRequest = {
                body: {
                    availableTriggerId: 'trigger-123',
                    triggerMetaData: {},
                    actions: []
                }
            };

            await ZapController.createZap(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(401);
        });
    });
});

describe('ZapController - Fetch Zap List', () => {
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

    describe('fetchZapList', () => {
        it('should return list of zaps for user', async () => {
            mockRequest = {
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZaps = [
                { id: 'zap-1', name: 'Zap 1', isEnabled: true },
                { id: 'zap-2', name: 'Zap 2', isEnabled: false }
            ];

            (client.zap.findMany as jest.Mock).mockResolvedValue(mockZaps);

            await ZapController.fetchZapList(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return empty array when no zaps exist', async () => {
            mockRequest = {
                // @ts-ignore
                userId: 'user-123'
            };

            (client.zap.findMany as jest.Mock).mockResolvedValue([]);

            await ZapController.fetchZapList(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return 401 if userId is not present', async () => {
            mockRequest = {};

            await ZapController.fetchZapList(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(401);
        });
    });
});

describe('ZapController - Fetch Zap by ID', () => {
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

    describe('fetchZapWithId', () => {
        it('should return zap with given ID', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZap = {
                id: 'zap-123',
                name: 'Test Zap',
                userId: 'user-123',
                trigger: { id: 'trigger-123', type: 'Webhook' },
                actions: [{ id: 'action-123', type: 'Email' }]
            };

            (client.zap.findFirst as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.fetchZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return 404 if zap not found', async () => {
            mockRequest = {
                params: { zapId: 'nonexistent' },
                // @ts-ignore
                userId: 'user-123'
            };

            (client.zap.findFirst as jest.Mock).mockResolvedValue(null);

            await ZapController.fetchZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });
    });
});

describe('ZapController - Delete Zap', () => {
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

    describe('deleteZapWithId', () => {
        it('should delete zap successfully', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123' };
            (client.zap.findFirst as jest.Mock).mockResolvedValue(mockZap);
            (client.zap.delete as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.deleteZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return 404 if zap not found', async () => {
            mockRequest = {
                params: { zapId: 'nonexistent' },
                // @ts-ignore
                userId: 'user-123'
            };

            (client.zap.findFirst as jest.Mock).mockResolvedValue(null);

            await ZapController.deleteZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(404);
        });
    });
});

describe('ZapController - Rename Zap', () => {
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

    describe('renameZapWithId', () => {
        it('should rename zap successfully', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: { name: 'New Zap Name' },
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', name: 'Old Name' };
            (client.zap.findFirst as jest.Mock).mockResolvedValue(mockZap);
            (client.zap.update as jest.Mock).mockResolvedValue({ ...mockZap, name: 'New Zap Name' });

            await ZapController.renameZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });
    });
});

describe('ZapController - Enable/Disable Zap', () => {
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

    describe('enableZapExecution', () => {
        it('should enable zap execution', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: { isEnabled: true },
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', isEnabled: false };
            (client.zap.findFirst as jest.Mock).mockResolvedValue(mockZap);
            (client.zap.update as jest.Mock).mockResolvedValue({ ...mockZap, isEnabled: true });

            await ZapController.enableZapExecution(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should disable zap execution', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: { isEnabled: false },
                // @ts-ignore
                userId: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', isEnabled: true };
            (client.zap.findFirst as jest.Mock).mockResolvedValue(mockZap);
            (client.zap.update as jest.Mock).mockResolvedValue({ ...mockZap, isEnabled: false });

            await ZapController.enableZapExecution(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });
    });
});
