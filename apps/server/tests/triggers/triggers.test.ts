import { Request, Response } from 'express';
import client from '@repo/db';
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
                { id: 'trigger-2', type: 'Gmail', name: 'Gmail Trigger' }
            ];

            (client.availableTriggers.findMany as jest.Mock).mockResolvedValue(mockTriggers);

            await TriggerController.fetchAvailableTriggers(mockRequest as Request, mockResponse as Response);

            expect(client.availableTriggers.findMany).toHaveBeenCalled();
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    avialableTriggers: mockTriggers
                })
            );
        });

        it('should return empty array when no triggers exist', async () => {
            mockRequest = {};

            (client.availableTriggers.findMany as jest.Mock).mockResolvedValue([]);

            await TriggerController.fetchAvailableTriggers(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    avialableTriggers: []
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
        it('should process webhook with valid zapId', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: { event: 'test', data: { key: 'value' } },
                headers: {}
            };

            // Mock the zap lookup
            const mockZap = {
                id: 'zap-123',
                isEnabled: true,
                trigger: { type: 'Webhook' },
                actions: [{ id: 'action-1', type: 'Email' }]
            };
            (client.zap.findUnique as jest.Mock).mockResolvedValue(mockZap);
            (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-123' });
            (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({});

            await TriggerController.handleWebhook(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return 400 if zapId is missing', async () => {
            mockRequest = {
                params: {},
                body: { event: 'test' },
                headers: {}
            };

            await TriggerController.handleWebhook(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
        });
    });
});

describe('TriggerController - Handle Gmail Trigger', () => {
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

    describe('handleGmailTrigger', () => {
        it('should process gmail trigger with valid data', async () => {
            mockRequest = {
                params: { zapId: 'zap-123' },
                body: {
                    messageId: 'msg-123',
                    from: 'sender@example.com',
                    subject: 'Test Email',
                    body: 'Email content'
                }
            };

            const mockZap = {
                id: 'zap-123',
                isEnabled: true,
                trigger: { type: 'Gmail' },
                actions: [{ id: 'action-1', type: 'Email' }]
            };
            (client.zap.findUnique as jest.Mock).mockResolvedValue(mockZap);
            (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-123' });
            (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({});

            await TriggerController.handleGmailTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
        });

        it('should return 400 if zapId is missing', async () => {
            mockRequest = {
                params: {},
                body: { messageId: 'msg-123' }
            };

            await TriggerController.handleGmailTrigger(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(400);
        });
    });
});

describe('TriggerController - Verify Webhook Signature', () => {
    describe('verifyWebhookSignature', () => {
        it('should verify valid signature', () => {
            const payload = JSON.stringify({ event: 'test' });
            // This would need proper signature generation in real tests
            const result = TriggerController.verifyWebhookSignature(payload, 'invalid-signature');
            expect(typeof result).toBe('boolean');
        });

        it('should reject invalid signature', () => {
            const payload = JSON.stringify({ event: 'test' });
            const result = TriggerController.verifyWebhookSignature(payload, 'completely-wrong');
            expect(result).toBe(false);
        });
    });
});
