import { CreateZapSchema, UpdateZapActionsSchema } from '@repo/types';
import { AiMetadataError, validateActionMetadata } from '../services/ai';
import { Request, Response } from 'express';
import { formatZodError } from '../helper';
import client from '@repo/db';
import {
  composeZap,
  removeZap,
  ZapCompositionError,
  type ZapCompositionErrorCode,
  type ZapDraft,
} from '../services/zapComposition';

/**
 * Composition failures → HTTP status.
 *
 * 411 is deliberate: this endpoint has always answered validation failures with
 * it and clients key off the shape, so it stays (see ADR-0004). Ownership is
 * the one case that used to surface as an opaque 400/500; it is now a real 403.
 */
const compositionFailureStatus = (code: ZapCompositionErrorCode): number => {
  switch (code) {
    case 'CONNECTION_NOT_OWNED':
      return 403;
    case 'TRIGGER_KIND_UNKNOWN':
      return 422;
    default:
      return 411;
  }
};

export const createZap = async (req: Request, res: Response): Promise<any> => {
  const validation = CreateZapSchema.safeParse(req.body);
  // @ts-ignore
  const id: string = req.id;

  if (validation.error) {
    return res.status(411).json({
      message: 'Incorrect inputs',
      error: formatZodError(validation.error),
    });
  }

  const draft: ZapDraft = {
    triggerId: validation.data.availableTriggerId,
    triggerMetadata: (validation.data.triggerMetaData ?? {}) as Record<string, unknown>,
    steps: validation.data.actions.map((action) => ({
      actionId: action.availableActionId,
      metadata: (action.actionMetaData ?? {}) as Record<string, unknown>,
      stepConditions: action.stepConditions ?? [],
    })),
  };

  try {
    const { zapId } = await composeZap(draft, { userId: Number(id) });
    return res.status(201).json({ message: 'Zap created successfully', zapId });
  } catch (error) {
    if (error instanceof ZapCompositionError) {
      return res
        .status(compositionFailureStatus(error.code))
        .json({ message: error.message, code: error.code });
    }
    console.log(error);
    return res.status(400).json({
      message: 'Failed to create a zap!',
      error: error,
    });
  }
};

export const fetchZapList = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const id = req.id;
    const zaps = await client.zap.findMany({
      where: {
        userId: id,
      },
      include: {
        actions: {
          include: {
            action: true,
          },
        },
        trigger: {
          include: {
            trigger: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: 'Zaps fetched successsfully',
      data: {
        zaps,
        total: zaps.length,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Could not fetch the zaps!',
      error: error?.response,
    });
  }
};

export const fetchZapWithId = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const id = req.id;
    const zap = await client.zap.findUnique({
      where: {
        userId: id,
        id: req.params.zapId as string,
      },
      include: {
        actions: {
          include: {
            action: true,
          },
        },
        trigger: {
          include: {
            trigger: true,
          },
        },
      },
    });

    return res.status(200).json({
      message: 'Zap fetched successfully',
      zap,
    });
  } catch (error: any) {
    res.status(500).json({
      message: 'Could not fetch the zap',
      error: error,
    });
  }
};

// The server-inline action executor (executeZapActions /
// processWebhookTrigger / executeGmailZapInline) lived here until
// gmail-worker-routing-spec P5. All trigger ingresses now enqueue
// ZapRun + ZapRunOutbox and apps/worker is the single execution
// engine — see TriggerController.handleWebhook and services/GmailDispatch.

export const deleteZapWithId = async (req: Request, res: Response): Promise<any> => {
  // @ts-ignore
  const id = req.id;
  const zapId = req.params.zapId as string;

  try {
    const { deletedZap } = await removeZap(zapId, { userId: Number(id) });
    return res.status(202).json({
      message: 'Zap deleted successfully',
      deletedZap,
    });
  } catch (error: any) {
    if (error instanceof ZapCompositionError) {
      return res
        .status(compositionFailureStatus(error.code))
        .json({ message: error.message, code: error.code });
    }
    console.error('Delete zap error:', error);
    return res.status(401).json({
      message: 'Could not delete the zap, Please try again',
      error: error.message,
    });
  }
};

export const renameZapWithId = async (req: Request, res: Response): Promise<any> => {
  // @ts-ignore
  const id = req.id;
  const { name } = req.body;

  try {
    const zap = await client.zap.update({
      where: {
        userId: id,
        id: req.params.zapId as string,
      },
      data: {
        name: name,
      },
    });

    res.status(200).json({
      message: 'Zap renamed successfully!',
      zap: zap,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: 'Could not rename the zap!',
      error: error,
    });
  }
};

export const enableZapExecution = async (req: Request, res: Response): Promise<any> => {
  // @ts-ignore
  const id = req.id;
  const { isActive } = req.body;

  try {
    const zap = await client.zap.update({
      where: {
        userId: id,
        id: req.params.zapId as string,
      },
      data: {
        isActive: isActive,
      },
    });

    res.status(200).json({
      message: 'Zap renamed successfully!',
      zap: zap,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: 'Could not rename the zap!',
      error: error,
    });
  }
};

export const updateZapWithId = async (req: Request, res: Response): Promise<any> => {
  try {
    const userId = Number((req as Request & { id?: unknown }).id);
    const parsed = UpdateZapActionsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(411).json({ message: 'Invalid action inputs' });
    const ownedZap = await client.zap.findFirst({
      where: { id: req.params.zapId as string, userId },
    });
    if (!ownedZap) return res.status(404).json({ message: 'Zap not found' });
    const actions = await validateActionMetadata(parsed.data.actions, userId);
    const zap = await client.$transaction(async (tx) => {
      await tx.action.deleteMany({ where: { zapId: ownedZap.id } });
      return tx.zap.update({
        where: { id: ownedZap.id, userId },
        data: {
          actions: {
            create: actions.map((action, index) => ({
              actionId: action.availableActionId,
              metadata: action.actionMetaData as any,
              stepConditions: action.stepConditions || [],
              sortingOrder: index + 1,
            })),
          },
        },
      });
    });
    return res.status(201).json({ message: 'Zap updated successfully', zap });
  } catch (error) {
    if (error instanceof AiMetadataError) return res.status(411).json({ message: error.message });
    return res.status(500).json({ message: 'Could not update the zap, please try again' });
  }
};

// Fetch Zap execution history
export const fetchZapRuns = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const zapId = req.params.zapId as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Verify the Zap belongs to the user
    const zap = await client.zap.findFirst({
      where: { id: zapId, userId },
    });

    if (!zap) {
      return res.status(404).json({ message: 'Zap not found' });
    }

    // Fetch runs with pagination
    const [runs, total] = await Promise.all([
      client.zapRun.findMany({
        where: { zapId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          zapId: true,
          metadata: true,
          status: true,
          errorMessage: true,
          completedAt: true,
          createdAt: true,
        },
      }),
      client.zapRun.count({ where: { zapId } }),
    ]);

    return res.status(200).json({
      message: 'Zap runs fetched successfully',
      data: {
        runs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error: any) {
    console.error('Fetch zap runs error:', error);
    res.status(500).json({
      message: 'Could not fetch zap runs',
      error: error.message,
    });
  }
};

// Update filter conditions for a Zap
export const updateZapFilters = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const zapId = req.params.zapId as string;
    const { filterConditions } = req.body;

    // Validate filterConditions is an array
    if (!Array.isArray(filterConditions)) {
      return res.status(400).json({
        message: 'filterConditions must be an array',
      });
    }

    // Validate each condition has required fields
    for (const condition of filterConditions) {
      if (!condition.field || !condition.operator) {
        return res.status(400).json({
          message: "Each condition must have 'field' and 'operator'",
        });
      }
    }

    // Verify the Zap belongs to the user
    const zap = await client.zap.findFirst({
      where: { id: zapId, userId: parseInt(userId) },
    });

    if (!zap) {
      return res.status(404).json({ message: 'Zap not found' });
    }

    // Update filter conditions
    const updatedZap = await client.zap.update({
      where: { id: zapId },
      data: { filterConditions },
    });

    return res.status(200).json({
      message: 'Filters updated successfully',
      data: {
        zapId,
        filterConditions: updatedZap.filterConditions,
      },
    });
  } catch (error: any) {
    console.error('Update filters error:', error);
    res.status(500).json({
      message: 'Could not update filters',
      error: error.message,
    });
  }
};
