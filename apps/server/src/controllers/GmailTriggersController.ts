import { Request, Response } from 'express';
import client from '@repo/db';
import {
  dispatchGmailEvent,
  gmailExecutionPath,
  mapGmailEventType,
  shouldTrigger,
} from '../services/GmailDispatch';
import { executeGmailZapInline } from './ZapController';

/**
 * Fan a Gmail event out to every Zap configured for one Gmail server.
 *
 * Routing (reports/gmail-worker-routing-spec.md, D6 kill-switch):
 * - GMAIL_EXECUTION_PATH=outbox → hydrate + dedup + ZapRun/ZapRunOutbox,
 *   executed by apps/worker like every other trigger (GmailDispatch).
 * - otherwise (default) → the legacy server-inline executor, byte-identical
 *   to the pre-spec behavior until the rollout flip in P4; both the switch
 *   and the inline path are deleted in P5.
 */
export const processGmailTrigger = async (serverId: string, emailData: any) => {
  try {
    if (gmailExecutionPath() === 'outbox') {
      // Resolve the concrete server row. Callers historically pass a
      // GmailServer id — the webhook controller passes an email address,
      // which cannot resolve until GmailServer.email lands in P3 (spec
      // audit B3). Unresolvable => log + no-op, never a synthetic run.
      const server = await client.gmailServer.findUnique({
        where: { id: serverId },
      });

      if (!server || !server.isActive) {
        console.warn(
          `Gmail outbox dispatch skipped: no active GmailServer with id "${serverId}" ` +
            '(email-address resolution lands with GmailServer.email in spec P3)'
        );
        return;
      }

      const messageId = emailData?.id || emailData?.messageId;
      if (!messageId) {
        console.warn('Gmail outbox dispatch skipped: event carries no message id');
        return;
      }

      await dispatchGmailEvent(
        server,
        messageId,
        mapGmailEventType(emailData?.eventType),
        emailData?.eventType
      );
      return;
    }

    // Legacy inline path (default until P4) — unchanged behavior.
    // Find all Gmail triggers for this server
    const gmailTriggers = await client.gmailTrigger.findMany({
      where: { serverId },
      include: { zap: true },
    });

    for (const gmailTrigger of gmailTriggers) {
      if (await shouldTrigger(gmailTrigger, emailData)) {
        await executeGmailZapInline(gmailTrigger.zap.id, emailData);
      }
    }
  } catch (error) {
    console.error('Error processing Gmail trigger:', error);
    throw error;
  }
};

export const createGmailTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId, zapId, triggerType, watchedLabels, senderFilter, subjectFilter, metadata } =
      req.body;

    // Validate required fields
    if (!serverId || !zapId || !triggerType) {
      return res.status(400).json({
        message: 'Server ID, Zap ID, and trigger type are required',
      });
    }

    // Check if Gmail server exists and belongs to user
    const gmailServer = await client.gmailServer.findFirst({
      where: {
        id: serverId,
        userId: parseInt(userId),
      },
    });

    if (!gmailServer) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    // Check if zap exists and belongs to user
    const zap = await client.zap.findFirst({
      where: {
        id: zapId,
        userId: parseInt(userId),
      },
    });

    if (!zap) {
      return res.status(404).json({
        message: 'Zap not found',
      });
    }

    // Create Gmail trigger
    const gmailTrigger = await client.gmailTrigger.create({
      data: {
        serverId,
        zapId,
        triggerType,
        watchedLabels: watchedLabels || [],
        senderFilter,
        subjectFilter,
        metadata,
      },
    });

    return res.status(201).json({
      message: 'Gmail trigger created successfully',
      gmailTrigger,
    });
  } catch (error) {
    console.error('Error creating Gmail trigger:', error);
    return res.status(500).json({
      message: 'Failed to create Gmail trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getGmailTriggers = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    const gmailTriggers = await client.gmailTrigger.findMany({
      where: {
        server: {
          userId: parseInt(userId),
          ...(serverId && { id: serverId as string }),
        },
      },
      include: {
        zap: true,
        server: true,
      },
    });

    return res.status(200).json({
      message: 'Gmail triggers retrieved successfully',
      gmailTriggers,
    });
  } catch (error) {
    console.error('Error fetching Gmail triggers:', error);
    return res.status(500).json({
      message: 'Failed to fetch Gmail triggers',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const updateGmailTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { triggerId } = req.params;
    const { triggerType, watchedLabels, senderFilter, subjectFilter, metadata } = req.body;

    const gmailTrigger = await client.gmailTrigger.updateMany({
      where: {
        id: triggerId as string,
        server: {
          userId: parseInt(userId),
        },
      },
      data: {
        ...(triggerType && { triggerType }),
        ...(watchedLabels && { watchedLabels }),
        ...(senderFilter !== undefined && { senderFilter }),
        ...(subjectFilter !== undefined && { subjectFilter }),
        ...(metadata && { metadata }),
      },
    });

    if (gmailTrigger.count === 0) {
      return res.status(404).json({
        message: 'Gmail trigger not found',
      });
    }

    return res.status(200).json({
      message: 'Gmail trigger updated successfully',
    });
  } catch (error) {
    console.error('Error updating Gmail trigger:', error);
    return res.status(500).json({
      message: 'Failed to update Gmail trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const deleteGmailTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { triggerId } = req.params;

    const gmailTrigger = await client.gmailTrigger.deleteMany({
      where: {
        id: triggerId as string,
        server: {
          userId: parseInt(userId),
        },
      },
    });

    if (gmailTrigger.count === 0) {
      return res.status(404).json({
        message: 'Gmail trigger not found',
      });
    }

    return res.status(200).json({
      message: 'Gmail trigger deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Gmail trigger:', error);
    return res.status(500).json({
      message: 'Failed to delete Gmail trigger',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
