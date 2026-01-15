import { Router } from 'express';
import { authMiddleware } from '../middlewares';
import {
    initiateAuth,
    handleCallback,
    getServers,
    deleteServer,
    listSpreadsheets,
    getSheetNames,
} from '../controllers/GoogleSheetsController';
import {
    createTrigger,
    getTriggers,
    updateTrigger,
    deleteTrigger,
} from '../controllers/GoogleSheetsTriggersController';

const router = Router();

// OAuth Routes
router.get('/auth/initiate', authMiddleware, initiateAuth);
router.get('/auth/callback', handleCallback); // No auth - Google redirects here

// Server Management Routes
router.get('/servers', authMiddleware, getServers);
router.delete('/servers/:serverId', authMiddleware, deleteServer);

// Spreadsheet Helper Routes
router.get('/spreadsheets', authMiddleware, listSpreadsheets);
router.get('/spreadsheets/:id/sheets', authMiddleware, getSheetNames);

// Trigger CRUD Routes
router.post('/triggers', authMiddleware, createTrigger);
router.get('/triggers', authMiddleware, getTriggers);
router.put('/triggers/:triggerId', authMiddleware, updateTrigger);
router.delete('/triggers/:triggerId', authMiddleware, deleteTrigger);

// Health check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'google-sheets' });
});

export default router;
