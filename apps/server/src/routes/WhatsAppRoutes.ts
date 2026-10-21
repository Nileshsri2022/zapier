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
          businessId,
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

    const { displayName, isActive, phoneNumber, businessId } = req.body;
    const normalizedBusinessId = typeof businessId === 'string' ? businessId.trim() : businessId;

    if (businessId !== undefined && !normalizedBusinessId) {
      return res.status(400).json({ message: 'WhatsApp Business Account ID is required' });
    }

    const updated = await client.whatsAppServer.update({
      where: { id: id as string },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(isActive !== undefined && { isActive }),
        ...(phoneNumber !== undefined && { phoneNumber }),
        ...(businessId !== undefined && { businessId: normalizedBusinessId }),
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
// WhatsApp Message Templates (A5 / Q-WA-A-02)
// ============================================

/**
 * Approved templates for the builder dropdown, fetched from Meta and reduced to
 * name/language/param count. The WABA access token stays server-side and is
 * never returned. `paramCount` counts {{n}} placeholders in the BODY component
 * so the builder can validate positional params before the run.
 */
router.get('/templates', authMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore - id is set by authMiddleware
    const userId = req.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const serverId = String(req.query.serverId ?? '');
    const server = await client.whatsAppServer.findFirst({
      where: { userId, isActive: true, ...(serverId ? { id: serverId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    if (!server) return res.status(404).json({ message: 'No active WhatsApp connection' });

    const businessId = server.businessId.trim();
    if (!businessId) {
      return res.status(422).json({
        code: 'WHATSAPP_BUSINESS_ID_REQUIRED',
        message: 'This WhatsApp connection is missing its WhatsApp Business Account ID.',
        remediation:
          'Enter the WABA ID below and save the connection, then load the approved templates again.',
      });
    }

    const url =
      `https://graph.facebook.com/v18.0/${businessId}/message_templates` +
      '?fields=name,language,status,components&limit=200';
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${server.accessToken}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return res.status(502).json({
        message: 'Meta rejected the template listing',
        status: response.status,
        error: body.slice(0, 300),
      });
    }
    const payload: any = await response.json().catch(() => ({}));
    const templates = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((entry: any) => String(entry?.status ?? '').toUpperCase() === 'APPROVED')
      .map((entry: any) => {
        const bodyComponent = (Array.isArray(entry?.components) ? entry.components : []).find(
          (component: any) => String(component?.type ?? '').toUpperCase() === 'BODY'
        );
        const text = String(bodyComponent?.text ?? '');
        const placeholders = new Set(
          Array.from(text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((match) => match[1])
        );
        return {
          name: String(entry?.name ?? ''),
          language: String(entry?.language ?? 'en_US'),
          paramCount: placeholders.size,
          status: 'APPROVED',
        };
      });

    res.json({ templates });
  } catch (error: any) {
    console.error('Error fetching WhatsApp templates:', error);
    res.status(500).json({ message: 'Failed to fetch WhatsApp templates' });
  }
});

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

    // A trigger may only target one of the caller's own Zaps. Without this
    // check a user could attach a trigger to another tenant's Zap.
    if (zapId) {
      const zap = await client.zap.findFirst({
        where: { id: zapId, userId },
      });
      if (!zap) {
        return res.status(404).json({ message: 'Zap not found' });
      }
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
