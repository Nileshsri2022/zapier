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
                // @ts-ignore - id is added by auth middleware
                id: 'user-123'
            };

            const mockZap = { id: 'zap-123' };

            (client.$transaction as jest.Mock).mockResolvedValue('zap-123');

            await ZapController.createZap(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(201);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Zap created successfully',
                    zapId: 'zap-123'
                })
            );
        });

        it('should return 411 for invalid zap data', async () => {
            mockRequest = {
                body: {
                    // Invalid - missing required fields
                },
                // @ts-ignore
                id: 'user-123'
            };

            await ZapController.createZap(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(411);
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
                id: 'user-123'
            };

            const mockZaps = [
                { id: 'zap-1', name: 'Zap 1', isEnabled: true },
                { id: 'zap-2', name: 'Zap 2', isEnabled: false }
            ];

            (client.zap.findMany as jest.Mock).mockResolvedValue(mockZaps);

            await ZapController.fetchZapList(mockRequest as Request, mockResponse as Response);

            expect(client.zap.findMany).toHaveBeenCalled();
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        zaps: mockZaps,
                        total: 2
                    })
                })
            );
        });

        it('should return empty array when no zaps exist', async () => {
            mockRequest = {
                // @ts-ignore
                id: 'user-123'
            };

            (client.zap.findMany as jest.Mock).mockResolvedValue([]);

            await ZapController.fetchZapList(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        zaps: [],
                        total: 0
                    })
                })
            );
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
                id: 'user-123'
            };

            const mockZap = {
                id: 'zap-123',
                name: 'Test Zap',
                userId: 'user-123',
                trigger: { id: 'trigger-123', type: 'Webhook' },
                actions: [{ id: 'action-123', type: 'Email' }]
            };

            (client.zap.findUnique as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.fetchZapWithId(mockRequest as Request, mockResponse as Response);

            expect(client.zap.findUnique).toHaveBeenCalled();
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: 'Zap fetched successfully',
                    zap: mockZap
                })
            );
        });

        it('should return 200 with null zap if not found', async () => {
            mockRequest = {
                params: { zapId: 'nonexistent' },
                // @ts-ignore
                id: 'user-123'
            };

            (client.zap.findUnique as jest.Mock).mockResolvedValue(null);

            await ZapController.fetchZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
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
                id: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123' };
            (client.zap.findUnique as jest.Mock).mockResolvedValue(mockZap);
            (client.zap.delete as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.deleteZapWithId(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(202);
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
                id: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', name: 'Old Name' };
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
                id: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', isEnabled: true };
            (client.zap.update as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.enableZapExecution(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should disable zap execution', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: { isEnabled: false },
                // @ts-ignore
                id: 'user-123'
            };

            const mockZap = { id: 'zap-123', userId: 'user-123', isEnabled: false };
            (client.zap.update as jest.Mock).mockResolvedValue(mockZap);

            await ZapController.enableZapExecution(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });
    });
});
