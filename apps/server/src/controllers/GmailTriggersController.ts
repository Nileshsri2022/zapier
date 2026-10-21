import { Request, Response } from 'express';
import client from '@repo/db';

/**
 * Gmail trigger CRUD. Delivery handling — turning a Gmail notification into
 * ZapRuns — lives in services/gmailIntake.ts; this controller only owns the
 * rows the intake module reads.
 */

export const createGmailTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId, zapId, triggerType, watchedLabels, senderFilter, subjectFilter, metadata } =
      req.body;
    const searchQuery =
      typeof req.body.searchQuery === 'string' ? req.body.searchQuery.trim() : undefined;

    // Validate required fields
    if (!serverId || !zapId || !triggerType) {
      return res.status(400).json({
        message: 'Server ID, Zap ID, and trigger type are required',
      });
    }

    // Grilled validation (Q-GMAIL-01): a matching-search trigger without a
    // query would either never fire or fan out the whole mailbox — reject at
    // the door.
    if (triggerType === 'matching_search' && !searchQuery) {
      return res.status(400).json({
        message: 'searchQuery is required for the matching_search trigger type',
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
        // searchQuery rides in metadata (no schema migration needed) so
        // shouldTrigger can read it alongside the other filters.
        metadata: { ...(metadata || {}), ...(searchQuery ? { searchQuery } : {}) },
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
    const searchQuery =
      typeof req.body.searchQuery === 'string' ? req.body.searchQuery.trim() : undefined;

    if (
      (triggerType === 'matching_search' || searchQuery !== undefined) &&
      triggerType === 'matching_search' &&
      !searchQuery
    ) {
      return res.status(400).json({
        message: 'searchQuery is required for the matching_search trigger type',
      });
    }

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
        ...(searchQuery !== undefined && {
          metadata: { ...((metadata as any) || {}), searchQuery },
        }),
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
