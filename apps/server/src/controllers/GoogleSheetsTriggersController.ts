import { Request, Response } from 'express';
import client from '@repo/db';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import { GoogleSheetsService } from '../services/GoogleSheetsService';

/**
 * Create a Google Sheets trigger
 */
export const createTrigger = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { serverId, zapId, spreadsheetId, sheetName } = req.body;

        // Validate required fields
        if (!serverId || !zapId || !spreadsheetId) {
            return res.status(400).json({
                message: 'Server ID, Zap ID, and Spreadsheet ID are required',
            });
        }

        // Verify server belongs to user
        const server = await client.googleSheetsServer.findFirst({
            where: {
                id: serverId,
                userId: parseInt(userId),
                isActive: true,
            },
        });

        if (!server) {
            return res.status(404).json({ message: 'Server not found' });
        }

        // Verify zap belongs to user
        const zap = await client.zap.findFirst({
            where: {
                id: zapId,
                userId: parseInt(userId),
            },
        });

        if (!zap) {
            return res.status(404).json({ message: 'Zap not found' });
        }

        // Check if trigger already exists for this zap
        const existingTrigger = await client.googleSheetsTrigger.findUnique({
            where: { zapId },
        });

        if (existingTrigger) {
            return res.status(400).json({
                message: 'Trigger already exists for this Zap',
            });
        }

        // Validate spreadsheet access
        const service = new GoogleSheetsService(
            {
                refreshToken: server.refreshToken,
                accessToken: server.accessToken,
                tokenExpiry: server.tokenExpiry || undefined,
            },
            server.id
        );

        const hasAccess = await service.validateAccess(spreadsheetId);
        if (!hasAccess) {
            return res.status(400).json({
                message: 'Cannot access spreadsheet. Make sure it is shared with your Google account.',
            });
        }

        // Create trigger
        const trigger = await client.googleSheetsTrigger.create({
            data: {
                serverId,
                zapId,
                spreadsheetId,
                sheetName: sheetName || 'Sheet1',
                isActive: true,
            },
        });

        // Initialize row hashes for existing rows (seed initial state)
        try {
            await service.pollForUpdates(trigger.id, spreadsheetId, sheetName || 'Sheet1');
            console.log(`📊 Initialized row hashes for trigger ${trigger.id}`);
        } catch (error) {
            console.error('⚠️ Could not initialize row hashes:', error);
            // Continue anyway - first real poll will initialize
        }

        return res.status(201).json({
            message: 'Google Sheets trigger created successfully',
            trigger: {
                id: trigger.id,
                spreadsheetId: trigger.spreadsheetId,
                sheetName: trigger.sheetName,
                isActive: trigger.isActive,
            },
        });
    } catch (error) {
        console.error('❌ Error creating trigger:', error);
        return res.status(500).json({
            message: 'Failed to create trigger',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Get user's Google Sheets triggers
 */
export const getTriggers = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { serverId } = req.query;

        const triggers = await client.googleSheetsTrigger.findMany({
            where: {
                server: {
                    userId: parseInt(userId),
                    isActive: true,
                    ...(serverId && { id: serverId as string }),
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

        return res.status(200).json({
            message: 'Triggers retrieved successfully',
            triggers,
        });
    } catch (error) {
        console.error('❌ Error fetching triggers:', error);
        return res.status(500).json({
            message: 'Failed to fetch triggers',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Update a Google Sheets trigger
 */
export const updateTrigger = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const triggerId = req.params.triggerId as string;
        const { spreadsheetId, sheetName, isActive } = req.body;

        if (!triggerId) {
            return res.status(400).json({ message: 'Trigger ID is required' });
        }

        // Verify ownership through server
        const trigger = await client.googleSheetsTrigger.findFirst({
            where: {
                id: triggerId,
                server: {
                    userId: parseInt(userId),
                },
            },
        });

        if (!trigger) {
            return res.status(404).json({ message: 'Trigger not found' });
        }

        // Update trigger
        const updated = await client.googleSheetsTrigger.update({
            where: { id: triggerId },
            data: {
                ...(spreadsheetId && { spreadsheetId }),
                ...(sheetName && { sheetName }),
                ...(typeof isActive === 'boolean' && { isActive }),
            },
        });

        // If spreadsheet or sheet changed, clear old hashes
        if (spreadsheetId || sheetName) {
            const triggerIdStr = Array.isArray(triggerId) ? triggerId[0]! : triggerId;
            const redisKey = GoogleSheetsService.getRedisKey(triggerIdStr);
            await redis.del(redisKey);
            console.log(`📊 Cleared row hashes for trigger ${triggerIdStr}`);
        }

        return res.status(200).json({
            message: 'Trigger updated successfully',
            trigger: updated,
        });
    } catch (error) {
        console.error('❌ Error updating trigger:', error);
        return res.status(500).json({
            message: 'Failed to update trigger',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};

/**
 * Delete a Google Sheets trigger
 */
export const deleteTrigger = async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const triggerId = req.params.triggerId as string;

        if (!triggerId) {
            return res.status(400).json({ message: 'Trigger ID is required' });
        }

        const triggerIdStr = Array.isArray(triggerId) ? triggerId[0]! : triggerId;

        // Verify ownership through server
        const trigger = await client.googleSheetsTrigger.findFirst({
            where: {
                id: triggerIdStr,
                server: {
                    userId: parseInt(userId),
                },
            },
        });

        if (!trigger) {
            return res.status(404).json({ message: 'Trigger not found' });
        }

        // Delete from database
        await client.googleSheetsTrigger.delete({
            where: { id: triggerIdStr },
        });

        // Clean up Redis hashes
        const redisKey = GoogleSheetsService.getRedisKey(triggerIdStr);
        await redis.del(redisKey);

        return res.status(200).json({
            message: 'Trigger deleted successfully',
        });
    } catch (error) {
        console.error('❌ Error deleting trigger:', error);
        return res.status(500).json({
            message: 'Failed to delete trigger',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
