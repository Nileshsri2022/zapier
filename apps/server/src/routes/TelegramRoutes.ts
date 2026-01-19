import { Router, Request, Response } from 'express';
import client from '@repo/db';
import axios from 'axios';
import { authMiddleware } from '../middlewares';

const router = Router();
const TELEGRAM_API = "https://api.telegram.org/bot";

// ============================================
// Telegram Bot Routes
// ============================================

// Get all bots for user
router.get('/bots', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const bots = await client.telegramBot.findMany({
            where: { userId },
            include: { triggers: true },
            orderBy: { createdAt: 'desc' }
        });

        // Hide tokens in response
        const safeBots = bots.map(bot => ({
            ...bot,
            botToken: '***hidden***'
        }));

        res.json({ bots: safeBots });
    } catch (error: any) {
        console.error('Error fetching Telegram bots:', error);
        res.status(500).json({ message: 'Failed to fetch bots', error: error.message });
    }
});

// Create new bot
router.post('/bots', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { botToken, botName } = req.body;

        if (!botToken || !botName) {
            return res.status(400).json({ message: 'Bot token and name are required' });
        }

        // Verify the bot token with Telegram API
        let botInfo;
        try {
            const meResponse = await axios.get(`${TELEGRAM_API}${botToken}/getMe`);
            botInfo = meResponse.data.result;
        } catch (error: any) {
            return res.status(400).json({
                message: 'Invalid bot token. Please check your token from BotFather.',
                error: error.response?.data?.description || error.message
            });
        }

        // Check if bot token already exists
        const existing = await client.telegramBot.findUnique({
            where: { botToken }
        });

        if (existing) {
            return res.status(400).json({ message: 'This bot is already registered' });
        }

        // Set webhook automatically
        const webhookUrl = `${process.env.HOOKS_URL || 'https://zapmate-hooks.onrender.com'}/api/webhooks/telegram`;
        try {
            await axios.post(`${TELEGRAM_API}${botToken}/setWebhook`, {
                url: webhookUrl,
                allowed_updates: ["message", "callback_query"]
            });
        } catch (error: any) {
            console.warn('Webhook setup warning:', error.response?.data?.description);
        }

        const bot = await client.telegramBot.create({
            data: {
                userId,
                botToken,
                botName,
                botUsername: botInfo.username,
                webhookConfigured: true
            }
        });

        res.status(201).json({
            message: `Bot @${botInfo.username} connected successfully!`,
            bot: { ...bot, botToken: '***hidden***' }
        });
    } catch (error: any) {
        console.error('Error creating Telegram bot:', error);
        res.status(500).json({ message: 'Failed to create bot', error: error.message });
    }
});

// Update bot
router.put('/bots/:id', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { id } = req.params;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const bot = await client.telegramBot.findFirst({
            where: { id: id as string, userId }
        });

        if (!bot) return res.status(404).json({ message: 'Bot not found' });

        const { botName, isActive } = req.body;

        const updated = await client.telegramBot.update({
            where: { id: id as string },
            data: {
                ...(botName !== undefined && { botName }),
                ...(isActive !== undefined && { isActive })
            }
        });

        res.json({ message: 'Bot updated', bot: { ...updated, botToken: '***hidden***' } });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to update bot', error: error.message });
    }
});

// Delete bot
router.delete('/bots/:id', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { id } = req.params;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const bot = await client.telegramBot.findFirst({
            where: { id: id as string, userId }
        });

        if (!bot) return res.status(404).json({ message: 'Bot not found' });

        // Remove webhook
        try {
            await axios.post(`${TELEGRAM_API}${bot.botToken}/deleteWebhook`);
        } catch (error) {
            console.warn('Webhook removal warning:', error);
        }

        // Delete triggers first
        await client.telegramTrigger.deleteMany({ where: { botId: id as string } });
        await client.telegramBot.delete({ where: { id: id as string } });

        res.json({ message: 'Bot disconnected successfully' });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to delete bot', error: error.message });
    }
});

// Test bot connection
router.post('/bots/:id/test', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { id } = req.params;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const bot = await client.telegramBot.findFirst({
            where: { id: id as string, userId }
        });

        if (!bot) return res.status(404).json({ message: 'Bot not found' });

        // Test the connection
        const response = await axios.get(`${TELEGRAM_API}${bot.botToken}/getMe`);

        res.json({
            success: true,
            message: 'Connection successful!',
            botInfo: {
                username: response.data.result.username,
                firstName: response.data.result.first_name
            }
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            message: 'Connection failed',
            error: error.response?.data?.description || error.message
        });
    }
});

// ============================================
// Telegram Trigger Routes
// ============================================

// Get triggers
router.get('/triggers', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { zapId, botId } = req.query;

        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const where: any = {
            bot: { userId }
        };

        if (zapId) where.zapId = zapId as string;
        if (botId) where.botId = botId as string;

        const triggers = await client.telegramTrigger.findMany({
            where,
            include: {
                bot: {
                    select: { id: true, botName: true, botUsername: true }
                },
                zap: {
                    select: { id: true, name: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({ triggers });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to fetch triggers', error: error.message });
    }
});

// Create trigger
router.post('/triggers', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        const { botId, zapId, eventType, filterCommand } = req.body;

        if (!botId) return res.status(400).json({ message: 'Bot ID is required' });

        // Verify bot ownership
        const bot = await client.telegramBot.findFirst({
            where: { id: botId, userId }
        });

        if (!bot) return res.status(404).json({ message: 'Bot not found' });

        const trigger = await client.telegramTrigger.create({
            data: {
                botId,
                zapId: zapId || null,
                eventType: eventType || 'message',
                filterCommand: filterCommand || null
            },
            include: {
                bot: { select: { id: true, botName: true } }
            }
        });

        res.status(201).json({ message: 'Trigger created', trigger });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to create trigger', error: error.message });
    }
});

// Delete trigger
router.delete('/triggers/:id', authMiddleware, async (req: Request, res: Response): Promise<any> => {
    try {
        // @ts-ignore
        const userId = req.id;
        const { id } = req.params;

        if (!userId) return res.status(401).json({ message: 'Unauthorized' });

        // Verify ownership through bot
        const trigger = await client.telegramTrigger.findFirst({
            where: { id: id as string },
            include: { bot: true }
        });

        // @ts-ignore
        if (!trigger || trigger.bot.userId !== userId) {
            return res.status(404).json({ message: 'Trigger not found' });
        }

        await client.telegramTrigger.delete({ where: { id: id as string } });

        res.json({ message: 'Trigger deleted successfully' });
    } catch (error: any) {
        res.status(500).json({ message: 'Failed to delete trigger', error: error.message });
    }
});

export default router;
