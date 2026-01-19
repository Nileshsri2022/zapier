import express, { Request, Response } from 'express';
import kafka from '@repo/kafka';
import client from '@repo/db';
import dotenv from 'dotenv';
import { orchestrator } from './pollers';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

let producer: any = null;
let isProducerConnected = false;

// Initialize Kafka producer with reconnection support
async function initKafka() {
  try {
    // If no producer or disconnected, create new one
    if (!producer || !isProducerConnected) {
      if (producer) {
        // Try to disconnect old producer gracefully
        try {
          await producer.disconnect();
        } catch (e) {
          // Ignore disconnect errors
        }
      }

      producer = kafka.producer({
        allowAutoTopicCreation: true,
        retry: {
          initialRetryTime: 100,
          retries: 5,
        },
      });

      // Set up event handlers
      producer.on('producer.connect', () => {
        console.log('✅ Kafka producer connected');
        isProducerConnected = true;
      });

      producer.on('producer.disconnect', () => {
        console.log('⚠️ Kafka producer disconnected');
        isProducerConnected = false;
      });

      await producer.connect();
      isProducerConnected = true;
    }

    return producer;
  } catch (error) {
    console.error('❌ Kafka connection error:', error);
    isProducerConnected = false;
    throw error;
  }
}

// Middleware to verify cron secret
function verifyCronSecret(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

// Process outbox - triggered by cron
app.post('/process', async (req: Request, res: Response): Promise<any> => {
  try {
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    // Verify cron secret if configured
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await initKafka();

    // Find pending outbox entries
    const pendingRows = await client.zapRunOutbox.findMany({
      where: {
        zapRun: {
          zap: {
            isActive: true,
          },
        },
      },
      take: 50, // Process up to 50 per cron trigger
    });

    if (pendingRows.length === 0) {
      return res.json({
        message: 'No pending items',
        processed: 0,
      });
    }

    // Send to Kafka
    await producer.send({
      topic: 'zap-events',
      messages: pendingRows.map((r: any) => ({
        value: JSON.stringify({ zapRunId: r.zapRunId, stage: 1 }),
      })),
    });

    // Delete processed entries
    await client.zapRunOutbox.deleteMany({
      where: {
        id: {
          in: pendingRows.map((r: any) => r.id),
        },
      },
    });

    console.log(`Processed ${pendingRows.length} outbox entries`);

    return res.json({
      message: 'Processing complete',
      processed: pendingRows.length,
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

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
  if (producer) {
    await producer.disconnect();
  }
  await client.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Processor service running on port ${PORT}`);
  console.log(`📋 Registered pollers: ${orchestrator.getRegisteredPollers().join(', ')}`);
});
