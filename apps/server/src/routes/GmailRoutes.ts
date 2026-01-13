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

const router = Router();

// Gmail Server Management Routes
router.post('/auth/initiate', initiateGmailAuth);
router.get('/auth/callback', handleGmailCallback);
router.get('/servers', getGmailServers);
router.get('/servers/:serverId', getGmailServer);
router.put('/servers/:serverId', updateGmailServer);
router.delete('/servers/:serverId', deleteGmailServer);
router.post('/servers/:serverId/test', testGmailConnection);
router.get('/servers/:serverId/ratelimit', getGmailRateLimitStatus);
router.post('/servers/:serverId/reset-circuit', resetGmailCircuitBreaker);

// Gmail Trigger Routes
router.post('/triggers', createGmailTrigger);
router.get('/triggers/:serverId?', getGmailTriggers);
router.put('/triggers/:triggerId', updateGmailTrigger);
router.delete('/triggers/:triggerId', deleteGmailTrigger);

// Gmail Webhook Route (for push notifications)
router.post('/webhook', handleGmailWebhook);

export default router;
