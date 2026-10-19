import { Router } from 'express';
import { AiStepError } from '@repo/ai';
import { authMiddleware } from '../middlewares';
import { aiCsrf, aiOwner } from '../middlewares/aiCsrf';
import { AiMetadataError, aiModels, previewAi } from '../services/ai';
const router = Router();
router.use(authMiddleware, aiCsrf);
router.get('/models', (_req, res) => {
  try {
    res.json(aiModels());
  } catch {
    res.status(503).json({ message: 'AI provider configuration is unavailable' });
  }
});
router.post('/test', async (req, res) => {
  try {
    res.json(await previewAi(req.body, aiOwner(req)));
  } catch (error) {
    const known = error instanceof AiMetadataError || error instanceof AiStepError;
    res
      .status(
        error instanceof AiMetadataError
          ? 411
          : error instanceof AiStepError && error.retryable
            ? 503
            : 400
      )
      .json({ message: known ? error.message : 'AI test failed; check provider configuration' });
  }
});
export default router;
