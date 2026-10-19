import express, { Request, Response, NextFunction } from 'express';
import client from '@repo/db';
import dotenv from 'dotenv';
import { disconnectRunDispatcher, enqueueRun } from '@repo/runs';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './whatsappHandler';
import { handleTelegramWebhook } from './telegramHandler';
import { handleGoogleCalendarWebhook } from './googleCalendarHandler';
import { verifyWebhookRequest } from './webhookAuth';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Webhook-Signature, X-Webhook-Secret, Authorization'
  );
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

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
      include: { trigger: true },
    });

    // F5: verify webhook signature/secret when WEBHOOK_SECRET or per-trigger
    // metadata.secret is configured (before dedup or ZapRun creation so
    // unauthenticated requests cannot pollute dedup keys or run history).
    const auth = verifyWebhookRequest(req.headers, triggerPayload, zap?.trigger?.metadata);
    if (!auth.authorized) {
      return res.status(auth.status ?? 401).json({
        message: auth.message ?? 'Unauthorized',
      });
    }

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

    const result = await enqueueRun({
      zapId: zapId as string,
      metadata: triggerPayload,
      source: 'hooks.webhook',
      dedup: {
        scope: 'webhook',
        key: eventId ? `${zapId}:${eventId}` : undefined,
      },
    });

    if (result.status === 'duplicate') {
      return res.status(200).json({
        success: true,
        message: 'Duplicate event skipped',
        eventId,
      });
    }

    if (result.status === 'skipped') {
      return res.status(201).json({
        message:
          result.reason === 'zap_not_found'
            ? 'Hook received but Zap not found'
            : 'Hook received but Zap is inactive',
      });
    }

    console.log(`📝 ZapRun queued: ${result.zapRunId}`);

    // Respond immediately — the worker picks up the event from Kafka
    res.status(201).json({
      message: 'Hook triggered - queued for processing',
      zapRunId: result.zapRunId,
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
// Bot id is part of the registered webhook URL (see TelegramRoutes).
app.post('/api/webhooks/telegram/:botId', handleTelegramWebhook);
app.post('/api/webhooks/telegram', handleTelegramWebhook);

// ============================================
// Google Calendar Webhook Routes (Push Notifications)
// ============================================
app.post('/api/webhooks/google-calendar', handleGoogleCalendarWebhook);

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
  await disconnectRunDispatcher();
  await client.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Hooks service running on port ${PORT} (queue mode: Kafka -> worker)`);
});
