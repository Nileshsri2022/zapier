import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AiConnectionError, CAPABILITY_PROFILES } from '@repo/ai-connections';
import { authMiddleware } from '../middlewares';
import { aiCsrf, aiOwner } from '../middlewares/aiCsrf';
import { previewAi } from '../services/ai';
import { AiStepError, readAiPolicy } from '@repo/ai';
import client from '@repo/db';
import { getAiConnectionService } from '../services/aiConnections';

const router = Router();
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    baseUrl: z.string().min(1).max(2048),
    apiKey: z
      .string()
      .min(1)
      .max(8192)
      .regex(/^[\x21-\x7e]+$/),
    capabilityProfileId: z.enum(
      CAPABILITY_PROFILES as ['chat_json_schema', 'chat_json_object', 'chat_prompt_json']
    ),
  })
  .strict();
const updateSchema = createSchema.partial().refine((value) => Object.keys(value).length > 0);

router.use(authMiddleware, aiCsrf);

function owner(req: Request): number {
  const userId = (req as Request & { id?: number }).id;
  if (!Number.isSafeInteger(userId) || !userId || userId < 1) {
    throw new AiConnectionError('NOT_FOUND', 'AI connection not found or unavailable');
  }
  return userId;
}
function failure(res: Response, error: unknown): void {
  if (error instanceof AiConnectionError) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFIGURATION' ? 503 : 400;
    res.status(status).json({ message: error.message });
  } else {
    // Do not log request bodies or raw DB/crypto errors (they may include credentials).
    res.status(500).json({ message: 'AI connection operation failed' });
  }
}
function id(req: Request): string {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success)
    throw new AiConnectionError('NOT_FOUND', 'AI connection not found or unavailable');
  return parsed.data;
}

router.get('/', async (req, res) => {
  try {
    res.json({ connections: await getAiConnectionService().list(owner(req)) });
  } catch (error) {
    failure(res, error);
  }
});
router.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(411).json({ message: 'Invalid AI connection settings' });
    return;
  }
  try {
    res
      .status(201)
      .json({ connection: await getAiConnectionService().create(owner(req), parsed.data) });
  } catch (error) {
    failure(res, error);
  }
});
router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(411).json({ message: 'Invalid AI connection settings' });
    return;
  }
  try {
    res.json({
      connection: await getAiConnectionService().update(id(req), owner(req), parsed.data),
    });
  } catch (error) {
    failure(res, error);
  }
});
router.delete('/:id', async (req, res) => {
  try {
    const connectionId = id(req);
    const userId = owner(req);
    await getAiConnectionService().revoke(connectionId, userId);
    const affectedZapCount = await client.zap.count({
      where: {
        userId,
        actions: {
          some: {
            action: { type: 'AI Transform' },
            metadata: { path: ['connectionId'], equals: connectionId },
          },
        },
      },
    });
    res.json({ revoked: true, affectedZapCount });
  } catch (error) {
    failure(res, error);
  }
});
router.post('/:id/test', async (req, res) => {
  const model = z.string().trim().min(1).max(200).safeParse(req.body?.model);
  if (!model.success) {
    res.status(411).json({ message: 'Model is required for connection test' });
    return;
  }
  try {
    const output = await previewAi(
      {
        provider: 'openai_compatible',
        connectionId: id(req),
        model: model.data,
        mode: 'summarize',
        input: 'Connection test: reply with OK.',
        maxOutputTokens: Math.min(64, readAiPolicy().maxOutputTokens),
      },
      aiOwner(req)
    );
    res.json(output);
  } catch (error) {
    res.status(error instanceof AiStepError && error.retryable ? 503 : 400).json({
      message: error instanceof AiStepError ? error.message : 'AI connection test failed',
    });
  }
});
export default router;
