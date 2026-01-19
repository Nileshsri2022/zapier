import { Router } from 'express';
import { authMiddleware } from '../middlewares';
import {
  initiateAuth,
  handleCallback,
  getServers,
  deleteServer,
  listCalendars,
  getEvents,
} from '../controllers/GoogleCalendarController';
import {
  createTrigger,
  getTriggers,
  updateTrigger,
  deleteTrigger,
  getTriggerTypes,
} from '../controllers/GoogleCalendarTriggersController';

const router = Router();

// ============================================
// OAuth Routes
// ============================================
router.get('/auth/initiate', authMiddleware, initiateAuth);
router.get('/auth/callback', handleCallback); // No auth - Google redirects here

// ============================================
// Server Management Routes
// ============================================
router.get('/servers', authMiddleware, getServers);
router.delete('/servers/:serverId', authMiddleware, deleteServer);

// ============================================
// Calendar Helper Routes
// ============================================
router.get('/calendars', authMiddleware, listCalendars);
router.get('/events', authMiddleware, getEvents);

// ============================================
// Trigger CRUD Routes
// ============================================
router.get('/trigger-types', authMiddleware, getTriggerTypes);
router.post('/triggers', authMiddleware, createTrigger);
router.get('/triggers', authMiddleware, getTriggers);
router.put('/triggers/:triggerId', authMiddleware, updateTrigger);
router.delete('/triggers/:triggerId', authMiddleware, deleteTrigger);

// ============================================
// Health Check
// ============================================
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'google-calendar' });
});

export default router;
