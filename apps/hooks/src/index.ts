import express, { Request, Response, NextFunction } from 'express';
import client from '@repo/db';
import dotenv from 'dotenv';
import { disconnectRunDispatcher, enqueueRun } from '@repo/runs';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './whatsappHandler';
import { handleTelegramWebhook } from './telegramHandler';
import { handleGoogleCalendarWebhook } from './googleCalendarHandler';
import { catchHookRouter } from './catchHook';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Enable CORS for all routes (T5: browsers may hit catch hooks — all five
// verbs must survive preflight)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Webhook-Signature, X-Webhook-Secret, X-Request-Id, Authorization'
  );
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// T5 catch hook — raw-captures its own body (size cap, five verbs, JSON/form
// parsing) and must run BEFORE the global JSON parser so the raw bytes are
// available for HMAC verification and bodyRaw.
app.use('/hooks', catchHookRouter);

app.use(express.json());

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'hooks' });
});

// Main webhook endpoint (T5 catch hook) is mounted above as catchHookRouter:
// all five verbs, test/prod URLs, auth modes, fixed-200 acks, dedupe.

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
