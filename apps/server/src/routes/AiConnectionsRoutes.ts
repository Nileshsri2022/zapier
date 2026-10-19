import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { AiConnectionError, CAPABILITY_PROFILES } from '@repo/ai-connections';
import { authMiddleware } from '../middlewares';
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

// Bearer-only in the foundation phase: avoid accepting cookie-authenticated secret mutations
// until the connection editor's CSRF flow is implemented. Never let a cookie override Bearer.
router.use((req, res, next) => {
  if (!req.headers.authorization?.startsWith('Bearer ') || req.cookies?.auth_token) {
    res.status(403).json({ message: 'AI connection management requires Bearer authentication' });
    return;
  }
  next();
}, authMiddleware);

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
    await getAiConnectionService().revoke(id(req), owner(req));
    res.status(204).send();
  } catch (error) {
    failure(res, error);
  }
});
// No probe endpoint until shared execution and budget accounting exist (P1/P3).
export default router;
