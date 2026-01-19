import { Router } from 'express';
import { authMiddleware, webhookLimiter } from '../middlewares';
import { fetchAvailableTriggers, handleWebhook } from '../controllers/TriggerController';

const router = Router();

router.get('/', authMiddleware, fetchAvailableTriggers);
// Webhook endpoint with permissive rate limiting (1000 req/15min)
router.post('/webhook/:zapId', webhookLimiter, handleWebhook);

export const TriggerRouter = router;
