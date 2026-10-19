import express, { Request, Response } from 'express';
import client from '@repo/db';
import dotenv from 'dotenv';
import { drainOutbox, disconnectRunDispatcher } from '@repo/runs';
import { orchestrator } from './pollers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware to verify cron secret
function verifyCronSecret(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  // Fail closed: an unset secret must reject, not allow
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'processor',
    registeredPollers: orchestrator.getRegisteredPollers(),
  });
});

// Process outbox - triggered by cron. The run-intake module owns batching,
// dispatch and stale-row cleanup.
app.post('/process', verifyCronSecret, async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await drainOutbox();

    return res.json({
      message: 'Processing complete',
      processed: result.dispatched + result.parked + result.cleaned,
      ...result,
    });
  } catch (error) {
    console.error('Processing error:', error);
    return res.status(500).json({
      error: 'Processing failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Generic Polling Endpoints (using Orchestrator)
// ============================================

/**
 * Poll ALL services (Google Sheets, Google Calendar, etc.)
 * Called by cron-job.org every 5 minutes
 */
app.post('/poll', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Fail closed: an unset secret must reject, not allow (undefined === undefined bug)
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const results = await orchestrator.pollAll();

    const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    return res.json({
      message: 'Polling complete',
      totalProcessed,
      totalErrors,
      results,
    });
  } catch (error) {
    console.error('Polling error:', error);
    return res.status(500).json({
      error: 'Polling failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Poll a SPECIFIC service (e.g., /poll/google-sheets or /poll/google-calendar)
 * Useful if you want different polling intervals per service
 */
app.post('/poll/:service', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Fail closed: an unset secret must reject, not allow (undefined === undefined bug)
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { service } = req.params;
    const result = await orchestrator.pollService(service);

    if (!result) {
      return res.status(404).json({
        error: `Unknown service: ${service}`,
        availableServices: orchestrator.getRegisteredPollers(),
      });
    }

    return res.json({
      message: `${service} polling complete`,
      ...result,
    });
  } catch (error) {
    console.error(`Polling error for ${req.params.service as string}:`, error);
    return res.status(500).json({
      error: 'Polling failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// Legacy endpoint (backwards compatible)
// ============================================
app.post('/poll-sheets', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Fail closed: an unset secret must reject, not allow (undefined === undefined bug)
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await orchestrator.pollService('google-sheets');

    return res.json({
      message: 'Google Sheets polling complete',
      processed: result?.processed || 0,
      errors: result?.errors || 0,
    });
  } catch (error) {
    console.error('Google Sheets polling error:', error);
    return res.status(500).json({
      error: 'Polling failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, shutting down...');
  await disconnectRunDispatcher();
  await client.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Processor service running on port ${PORT}`);
  console.log(`📋 Registered pollers: ${orchestrator.getRegisteredPollers().join(', ')}`);
});
