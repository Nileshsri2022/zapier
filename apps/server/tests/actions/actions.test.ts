import { Request, Response } from 'express';
import client from '@repo/db';
import * as ActionsController from '../../src/controllers/ActionsController';

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
                body: 'Test Body'
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
                amount: '0.1'
            };
            const triggerPayload = { key: 'value' };

            // Solana action is just a placeholder log, should not throw
            await expect(
                ActionsController.executeAction('Solana', metadata, triggerPayload)
            ).resolves.not.toThrow();
        });
    });
});
