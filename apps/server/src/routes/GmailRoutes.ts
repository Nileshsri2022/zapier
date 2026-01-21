import { Router } from 'express';
import {
  initiateGmailAuth,
  handleGmailCallback,
  getGmailServers,
  getGmailServer,
  updateGmailServer,
  deleteGmailServer,
  testGmailConnection,
  getGmailRateLimitStatus,
  resetGmailCircuitBreaker,
} from '../controllers/GmailController';
import {
  createGmailTrigger,
  getGmailTriggers,
  updateGmailTrigger,
  deleteGmailTrigger,
} from '../controllers/GmailTriggersController';
import { handleGmailWebhook } from '../controllers/GmailWebhookController';
import { authMiddleware } from '../middlewares';

const router = Router();

// Gmail Server Management Routes (require auth)
router.post('/auth/initiate', authMiddleware, initiateGmailAuth);
router.get('/auth/callback', handleGmailCallback); // No auth - called by Google
router.get('/servers', authMiddleware, getGmailServers);
router.get('/servers/:serverId', authMiddleware, getGmailServer);
router.put('/servers/:serverId', authMiddleware, updateGmailServer);
router.delete('/servers/:serverId', authMiddleware, deleteGmailServer);
router.post('/servers/:serverId/test', authMiddleware, testGmailConnection);
router.get('/servers/:serverId/ratelimit', authMiddleware, getGmailRateLimitStatus);
router.post('/servers/:serverId/reset-circuit', authMiddleware, resetGmailCircuitBreaker);

// Gmail Trigger Routes (require auth)
router.post('/triggers', authMiddleware, createGmailTrigger);
router.get('/triggers/:serverId?', authMiddleware, getGmailTriggers);
router.put('/triggers/:triggerId', authMiddleware, updateGmailTrigger);
router.delete('/triggers/:triggerId', authMiddleware, deleteGmailTrigger);

// Gmail Webhook Route (for push notifications - no auth, validated by Google)
router.post('/webhook', handleGmailWebhook);

export default router;
