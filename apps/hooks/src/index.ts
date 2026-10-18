import express, { Request, Response, NextFunction } from 'express';
import kafka from '@repo/kafka';
import client from '@repo/db';
import dotenv from 'dotenv';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './whatsappHandler';
import { handleTelegramWebhook } from './telegramHandler';
import { handleGoogleCalendarWebhook } from './googleCalendarHandler';
import { isDuplicateEvent } from './dedup';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

const TOPIC_NAME = 'zap-events';

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

/**
 * Enqueue a ZapRun for the worker (single execution engine).
 *
 * All triggers — webhooks, schedules, polls — funnel into Kafka here and are
 * executed by apps/worker, which knows the full action catalog, retries,
 * filters/conditions and output chaining. Previously this service also ran a
 * legacy inline executor (Email/Solana only) that marked unimplemented
 * actions as completed (gap D1 in reports/workflow-execution-gaps.md).
 */
async function enqueueZapRun(zapRunId: string): Promise<void> {
  const producer = kafka.producer();
  await producer.connect();
  try {
    await producer.send({
      topic: TOPIC_NAME,
      messages: [{ value: JSON.stringify({ zapRunId, stage: 1 }) }],
    });
  } finally {
    await producer.disconnect();
  }
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'hooks' });
});

// Main webhook endpoint — queued to the worker for processing
app.post('/hooks/:userId/:zapId', async (req: Request, res: Response): Promise<any> => {
  const { zapId } = req.params;
  const triggerPayload = req.body;

  if (!zapId) {
    res.status(400).json({ message: 'Zap ID is required' });
    return;
  }

  console.log(`📨 Webhook received for zap: ${zapId}`);

  try {
    const zap = await client.zap.findUnique({
      where: { id: zapId },
      include: { actions: true },
    });

    // Dedup: webhook clients are encouraged to include an `event_id` (or
    // `eventId`) in the body so redeliveries can be dropped. Without one the
    // event cannot be deduplicated (fail open).
    const payload = (triggerPayload || {}) as Record<string, any>;
    const eventId =
      typeof payload.event_id === 'string'
        ? payload.event_id
        : typeof payload.eventId === 'string'
          ? payload.eventId
          : undefined;

    if (await isDuplicateEvent('webhook', eventId ? `${zapId}:${eventId}` : undefined)) {
      return res.status(200).json({
        success: true,
        message: 'Duplicate event skipped',
        eventId,
      });
    }

    // Create ZapRun record for history
    const zapRun = await client.zapRun.create({
      data: {
        zapId: zapId as string,
        metadata: triggerPayload,
      },
    });

    console.log(`📝 ZapRun created: ${zapRun.id}`);

    if (!zap) {
      await client.zapRun.update({
        where: { id: zapRun.id },
        data: { status: 'failed', errorMessage: 'Zap not found', completedAt: new Date() },
      });
      return res.status(201).json({
        message: 'Hook received but Zap not found',
        zapRunId: zapRun.id,
      });
    }

    if (!zap.isActive) {
      await client.zapRun.update({
        where: { id: zapRun.id },
        data: { status: 'failed', errorMessage: 'Zap is inactive', completedAt: new Date() },
      });
      return res.status(201).json({
        message: 'Hook received but Zap is inactive',
        zapRunId: zapRun.id,
      });
    }

    await enqueueZapRun(zapRun.id);

    // Respond immediately — the worker picks up the event from Kafka
    res.status(201).json({
      message: 'Hook triggered - queued for processing',
      zapRunId: zapRun.id,
    });
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.status(500).json({
      message: 'Webhook processing failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ============================================
// WhatsApp Webhook Routes
// ============================================
app.get('/api/webhooks/whatsapp', verifyWhatsAppWebhook);
app.post('/api/webhooks/whatsapp', handleWhatsAppWebhook);

// ============================================
// Telegram Webhook Routes
// ============================================
app.post('/api/webhooks/telegram', handleTelegramWebhook);

// ============================================
// Google Calendar Webhook Routes (Push Notifications)
// ============================================
app.post('/api/webhooks/google-calendar', handleGoogleCalendarWebhook);

// ============================================
// Schedule Webhook Routes (from cron service)
// ============================================
app.post('/api/webhooks/schedule', async (req: Request, res: Response) => {
  const { zapRunId } = req.body;

  if (!zapRunId) {
    return res.status(400).json({ error: 'zapRunId is required' });
  }

  console.log(`📅 Schedule webhook received for ZapRun: ${zapRunId}`);

  try {
    const zapRun = await client.zapRun.findUnique({
      where: { id: zapRunId },
    });

    if (!zapRun) {
      return res.status(404).json({ error: 'ZapRun not found' });
    }

    // Queue stage 1 for the worker (single execution engine)
    await enqueueZapRun(zapRunId);

    res.status(200).json({
      success: true,
      message: 'Schedule queued for processing',
      zapRunId,
    });
  } catch (error: any) {
    console.error('Schedule webhook error:', error);
    return res.status(500).json({
      message: 'Schedule processing failed',
      error: error.message,
    });
  }
});

// JSON parsing error handler (must be after routes)
app.use((err: any, req: any, res: any, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    console.log(`⚠️ Invalid JSON received at ${req.path}`);
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  next(err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('📛 SIGTERM received, shutting down...');
  await client.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Hooks service running on port ${PORT} (queue mode: Kafka -> worker)`);
});
