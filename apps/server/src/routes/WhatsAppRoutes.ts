import { Router, Request, Response } from 'express';
import client from '@repo/db';
import { authMiddleware, validateBody } from '../middlewares';
import { ConnectWhatsAppSchema } from '@repo/types';

const router = Router();

// ============================================
// WhatsApp Server (Account) Routes
// ============================================

// Get all WhatsApp servers for the user
router.get('/servers', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore - id is set by authMiddleware
    const userId = req.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const servers = await client.whatsAppServer.findMany({
      where: { userId },
      include: {
        triggers: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Don't expose access tokens in response
    const sanitizedServers = servers.map((server) => ({
      ...server,
      accessToken: '***hidden***',
    }));

    res.json({ servers: sanitizedServers });
  } catch (error: any) {
    console.error('Error fetching WhatsApp servers:', error);
    res.status(500).json({ message: 'Failed to fetch WhatsApp servers', error: error.message });
  }
});

// Create WhatsApp server
router.post(
  '/servers',
  authMiddleware,
  validateBody(ConnectWhatsAppSchema),
  async (req: Request, res: Response): Promise<any> => {
    try {
      // @ts-ignore
      const userId = req.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const { displayName, phoneNumberId, businessId, accessToken, phoneNumber } = req.body;

      // Check for duplicate phone number ID
      const existing = await client.whatsAppServer.findUnique({
        where: { phoneNumberId },
      });

      if (existing) {
        return res.status(400).json({ message: 'This phone number ID is already registered' });
      }

      const server = await client.whatsAppServer.create({
        data: {
          userId,
          displayName,
          phoneNumberId,
          businessId: businessId || '',
          accessToken,
          phoneNumber: phoneNumber || '',
        },
      });

      res.status(201).json({
        message: 'WhatsApp server created successfully',
        server: { ...server, accessToken: '***hidden***' },
      });
    } catch (error: any) {
      console.error('Error creating WhatsApp server:', error);
      res.status(500).json({ message: 'Failed to create WhatsApp server', error: error.message });
    }
  }
);

// Update WhatsApp server
router.put('/servers/:id', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Verify ownership
    const server = await client.whatsAppServer.findFirst({
      where: { id: id as string, userId },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    const { displayName, isActive, phoneNumber } = req.body;

    const updated = await client.whatsAppServer.update({
      where: { id: id as string },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(isActive !== undefined && { isActive }),
        ...(phoneNumber !== undefined && { phoneNumber }),
      },
    });

    res.json({ message: 'Server updated', server: { ...updated, accessToken: '***hidden***' } });
  } catch (error: any) {
    console.error('Error updating WhatsApp server:', error);
    res.status(500).json({ message: 'Failed to update server', error: error.message });
  }
});

// Delete WhatsApp server
router.delete('/servers/:id', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // Verify ownership
    const server = await client.whatsAppServer.findFirst({
      where: { id: id as string, userId },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    // Delete associated triggers first
    await client.whatsAppTrigger.deleteMany({
      where: { serverId: id as string },
    });

    await client.whatsAppServer.delete({
      where: { id: id as string },
    });

    res.json({ message: 'Server deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting WhatsApp server:', error);
    res.status(500).json({ message: 'Failed to delete server', error: error.message });
  }
});

// Test WhatsApp connection
router.post(
  '/servers/:id/test',
  authMiddleware,
  async (req: Request, res: Response): Promise<any> => {
    try {
      // @ts-ignore
      const userId = req.id;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      const server = await client.whatsAppServer.findFirst({
        where: { id: id as string, userId },
      });

      if (!server) {
        return res.status(404).json({ message: 'Server not found' });
      }

      // Test the connection by calling Meta API
      const axios = require('axios');
      const response = await axios.get(`https://graph.facebook.com/v18.0/${server.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${server.accessToken}` },
      });

      res.json({
        success: true,
        message: 'Connection successful',
        phoneNumber: response.data.display_phone_number,
      });
    } catch (error: any) {
      console.error('WhatsApp connection test failed:', error.response?.data || error.message);
      res.status(400).json({
        success: false,
        message: 'Connection failed',
        error: error.response?.data?.error?.message || error.message,
      });
    }
  }
);

// ============================================
// WhatsApp Trigger Routes
// ============================================

// Get triggers
router.get('/triggers', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { zapId, serverId } = req.query;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const where: any = {
      server: { userId },
    };

    if (zapId) where.zapId = zapId;
    if (serverId) where.serverId = serverId;

    const triggers = await client.whatsAppTrigger.findMany({
      where,
      include: {
        server: {
          select: { id: true, displayName: true, phoneNumber: true },
        },
        zap: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ triggers });
  } catch (error: any) {
    console.error('Error fetching triggers:', error);
    res.status(500).json({ message: 'Failed to fetch triggers', error: error.message });
  }
});

// Create trigger
router.post('/triggers', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { serverId, zapId, eventType } = req.body;

    if (!serverId) {
      return res.status(400).json({ message: 'Server ID is required' });
    }

    // Verify server ownership
    const server = await client.whatsAppServer.findFirst({
      where: { id: serverId, userId },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    const trigger = await client.whatsAppTrigger.create({
      data: {
        serverId,
        zapId: zapId || null,
        eventType: eventType || 'message_received',
      },
      include: {
        server: {
          select: { id: true, displayName: true },
        },
      },
    });

    res.status(201).json({ message: 'Trigger created', trigger });
  } catch (error: any) {
    console.error('Error creating trigger:', error);
    res.status(500).json({ message: 'Failed to create trigger', error: error.message });
  }
});

// Delete trigger
router.delete(
  '/triggers/:id',
  authMiddleware,
  async (req: Request, res: Response): Promise<any> => {
    try {
      // @ts-ignore
      const userId = req.id;
      const { id } = req.params;

      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Verify ownership through server
      const trigger = await client.whatsAppTrigger.findFirst({
        where: { id: id as string },
        include: { server: true },
      });

      // @ts-ignore - server is included
      if (!trigger || trigger.server.userId !== userId) {
        return res.status(404).json({ message: 'Trigger not found' });
      }

      await client.whatsAppTrigger.delete({
        where: { id: id as string },
      });

      res.json({ message: 'Trigger deleted successfully' });
    } catch (error: any) {
      console.error('Error deleting trigger:', error);
      res.status(500).json({ message: 'Failed to delete trigger', error: error.message });
    }
  }
);

export default router;
