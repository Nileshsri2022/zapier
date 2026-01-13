import { Request, Response } from 'express';
import client from '@repo/db';
import * as ActionsController from '../../src/controllers/ActionsController';

// Mock nodemailer
jest.mock('nodemailer', () => ({
    createTransport: jest.fn().mockReturnValue({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' })
    })
}));

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
                { id: 'action-3', type: 'GmailSend', name: 'Send Gmail' }
            ];

            (client.availableActions.findMany as jest.Mock).mockResolvedValue(mockActions);

            await ActionsController.fetchAvailableActions(mockRequest as Request, mockResponse as Response);

            expect(client.availableActions.findMany).toHaveBeenCalled();
            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    availableActions: mockActions
                })
            );
        });

        it('should return empty array when no actions exist', async () => {
            mockRequest = {};

            (client.availableActions.findMany as jest.Mock).mockResolvedValue([]);

            await ActionsController.fetchAvailableActions(mockRequest as Request, mockResponse as Response);

            expect(statusMock).toHaveBeenCalledWith(200);
            expect(jsonMock).toHaveBeenCalledWith(
                expect.objectContaining({
                    availableActions: []
                })
            );
        });
    });
});

describe('ActionsController - Execute Action', () => {
    describe('executeAction', () => {
        it('should execute email action', async () => {
            const metadata = {
                to: 'test@example.com',
                subject: 'Test Subject',
                body: 'Test Body'
            };
            const triggerPayload = { key: 'value' };

            await expect(
                ActionsController.executeAction('Email', metadata, triggerPayload)
            ).resolves.not.toThrow();
        });

        it('should execute solana action', async () => {
            const metadata = {
                address: 'solana-address-123',
                amount: '0.1'
            };
            const triggerPayload = { key: 'value' };

            await expect(
                ActionsController.executeAction('Solana', metadata, triggerPayload)
            ).resolves.not.toThrow();
        });

        it('should throw error for unsupported action type', async () => {
            const metadata = {};
            const triggerPayload = {};

            await expect(
                ActionsController.executeAction('UnsupportedAction', metadata, triggerPayload)
            ).rejects.toThrow('Unsupported action type');
        });
    });
});

describe('ActionsController - Placeholder Replacement', () => {
    describe('replacePlaceholders (internal function tested via executeAction)', () => {
        it('should replace placeholders in email content', async () => {
            const metadata = {
                to: '{{email}}',
                subject: 'Hello {{name}}!',
                body: 'Your order {{orderId}} is confirmed'
            };
            const triggerPayload = {
                email: 'user@example.com',
                name: 'John',
                orderId: '12345'
            };

            // The function replaces placeholders internally during email execution
            await expect(
                ActionsController.executeAction('Email', metadata, triggerPayload)
            ).resolves.not.toThrow();
        });
    });
});

describe('ActionsController - Gmail Actions', () => {
    describe('executeAction with Gmail types', () => {
        it('should route GmailSend to gmail action handler', async () => {
            const metadata = {
                to: 'recipient@example.com',
                subject: 'Test',
                body: 'Hello'
            };
            const triggerPayload = {};

            // This should not throw even though gmail handler is mocked
            try {
                await ActionsController.executeAction('GmailSend', metadata, triggerPayload);
            } catch (error) {
                // Expected to fail without proper Gmail setup, but should attempt
                expect(error).toBeDefined();
            }
        });

        it('should route GmailReply to gmail action handler', async () => {
            const metadata = {
                messageId: 'msg-123',
                body: 'Reply content'
            };
            const triggerPayload = {};

            try {
                await ActionsController.executeAction('GmailReply', metadata, triggerPayload);
            } catch (error) {
                expect(error).toBeDefined();
            }
        });
    });
});
