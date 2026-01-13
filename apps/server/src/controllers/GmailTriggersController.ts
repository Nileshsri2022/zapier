import { Request, Response } from 'express';
import client from '@repo/db';
import { GmailService } from '../services/GmailService';

export const processGmailTrigger = async (serverId: string, emailData: any) => {
  try {
    // Find all Gmail triggers for this server
    const gmailTriggers = await client.gmailTrigger.findMany({
      where: { serverId },
      include: { zap: true },
    });

    for (const gmailTrigger of gmailTriggers) {
      if (await shouldTrigger(gmailTrigger, emailData)) {
        // Process the zap
        await processGmailZap(gmailTrigger.zap.id, emailData);
      }
    }
  } catch (error) {
    console.error('Error processing Gmail trigger:', error);
    throw error;
  }
};

const shouldTrigger = async (gmailTrigger: any, emailData: any): Promise<boolean> => {
  try {
    const { triggerType, watchedLabels, senderFilter, subjectFilter, metadata } = gmailTrigger;

    // Check trigger type
    switch (triggerType) {
      case 'new_email':
        return isNewEmailTrigger(emailData, { watchedLabels, senderFilter, subjectFilter, metadata });
      case 'labeled':
        return isLabeledTrigger(emailData, metadata);
      case 'starred':
        return isStarredTrigger(emailData, metadata);
      case 'moved':
        return isMovedTrigger(emailData, metadata);
      default:
        return false;
    }
  } catch (error) {
    console.error('Error checking trigger condition:', error);
    return false;
  }
};

const isNewEmailTrigger = (emailData: any, filters: any): boolean => {
  // Check if email matches the filters
  if (filters.watchedLabels && filters.watchedLabels.length > 0) {
    const hasWatchedLabel = emailData.labels?.some((label: string) =>
      filters.watchedLabels.includes(label)
    );
    if (!hasWatchedLabel) return false;
  }

  if (filters.senderFilter) {
    const senderMatch = emailData.from?.toLowerCase().includes(filters.senderFilter.toLowerCase());
    if (!senderMatch) return false;
  }

  if (filters.subjectFilter) {
    const subjectMatch = emailData.subject?.toLowerCase().includes(filters.subjectFilter.toLowerCase());
    if (!subjectMatch) return false;
  }

  return true;
};

const isLabeledTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was recently labeled
  const targetLabels = metadata?.targetLabels || [];
  return emailData.labels?.some((label: string) => targetLabels.includes(label));
};

const isStarredTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was starred
  return emailData.labels?.includes('STARRED');
};

const isMovedTrigger = (emailData: any, metadata: any): boolean => {
  // Check if email was moved to specific folder
  const targetFolder = metadata?.targetFolder;
  return emailData.labels?.includes(targetFolder);
};

const processGmailZap = async (zapId: string, emailData: any) => {
  try {
    // Get zap with actions
    const zap = await client.zap.findUnique({
      where: { id: zapId },
      include: {
        actions: {
          include: { action: true },
          orderBy: { sortingOrder: 'asc' },
        },
      },
    });

    if (!zap || !zap.isActive) {
      console.log(`Zap ${zapId} not found or inactive`);
      return;
    }

    console.log(`Processing Gmail trigger for zap ${zapId} with ${zap.actions.length} actions`);

    // Execute each action in order
    for (const zapAction of zap.actions) {
      try {
        // Import the executeAction function from ActionsController
        const { executeAction } = await import('./ActionsController.js');
        await executeAction(zapAction.action.type, zapAction.metadata, emailData);
        console.log(`Executed action ${zapAction.action.type} successfully`);
      } catch (error) {
        console.error(`Failed to execute action ${zapAction.action.type}:`, error);
      }
    }

    // Log the Gmail trigger execution
    await client.zapRun.create({
      data: {
        zapId: zap.id,
        metadata: emailData,
      },
    });

    console.log(`Gmail trigger processed successfully for zap ${zapId}`);
  } catch (error) {
    console.error(`Error processing Gmail zap ${zapId}:`, error);
    throw error;
  }
};

export const createGmailTrigger = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId, zapId, triggerType, watchedLabels, senderFilter, subjectFilter, metadata } = req.body;

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
          ...(serverId && { id: serverId }),
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
        id: triggerId,
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
        id: triggerId,
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
