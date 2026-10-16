import express, { Request, Response, NextFunction } from 'express';
import client from '@repo/db';
import { sendEmailWithTextBody } from '@repo/email';
import dotenv from 'dotenv';
import { verifyWhatsAppWebhook, handleWhatsAppWebhook } from './whatsappHandler';
import { handleTelegramWebhook } from './telegramHandler';
import { handleGoogleCalendarWebhook } from './googleCalendarHandler';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

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

// JSON parsing error handler will be added after routes

// Helper: Replace placeholders in templates
function replaceKeys(template: string, replacements: Record<string, string>): string {
  return template.replace(/{(.*?)}/g, (_, key) => {
    return replacements[key] || `{${key}}`;
  });
}

// Helper: Validate email format
const validateEmail = (email: string) => {
  const regex = /^\S+@\S+\.\S+$/;
  return regex.test(email);
};

// Execute a single action
async function executeAction(action: any, metadata: any, triggerPayload: any) {
  const actionType = action?.action?.type;

  console.log(`Executing action: ${actionType}`);

  switch (actionType) {
    case 'Email':
      await executeEmailAction(action.metadata, triggerPayload);
      break;
    case 'Solana':
      await executeSolanaAction(action.metadata, triggerPayload);
      break;
    default:
      console.log(`Unknown action type: ${actionType}`);
  }
}

// Execute email action
async function executeEmailAction(metadata: any, triggerPayload: any) {
  try {
    // Parse metadata if it's a string
    let parsedMetadata = metadata;
    if (typeof metadata === 'string') {
      try {
        parsedMetadata = JSON.parse(metadata);
      } catch {
        console.error('❌ Failed to parse metadata as JSON:', metadata);
      }
    }

    if (!parsedMetadata) {
      console.error('❌ No metadata provided for email action');
      return;
    }

    const { to, subject, body } = parsedMetadata;
    console.log(`📧 Email config: to=${to}, subject=${subject}, body length=${body?.length || 0}`);

    let emailReceiver: string;

    if (to && validateEmail(to)) {
      emailReceiver = to;
    } else {
      // Try to extract email from trigger payload
      const searchKey = JSON.stringify(triggerPayload);
      const emailMatch = searchKey.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      emailReceiver = emailMatch ? emailMatch[0] : to;
      console.log(`📧 Email extracted from payload: ${emailReceiver}`);
    }

    if (!emailReceiver || !validateEmail(emailReceiver)) {
      console.error(`❌ Invalid email recipient: ${emailReceiver}`);
      return;
    }

    const emailBody = replaceKeys(body || '', triggerPayload);
    const emailSubject = replaceKeys(subject || 'No Subject', triggerPayload);

    console.log(`📧 Sending email to: ${emailReceiver}`);
    await sendEmailWithTextBody(emailReceiver, emailSubject, emailBody);
    console.log(`✅ Email sent successfully to ${emailReceiver}`);
  } catch (error) {
    console.error('❌ Email action failed:', error);
    throw error;
  }
}

// Execute Solana action (placeholder)
async function executeSolanaAction(metadata: any, triggerPayload: any) {
  try {
    const { address, amount } = metadata;
    const finalAddress = replaceKeys(address || '', triggerPayload);
    const finalAmount = replaceKeys(amount || '', triggerPayload);

    console.log(`💰 Solana: Sending ${finalAmount} SOL to ${finalAddress}`);
    // TODO: Implement actual Solana transaction
    console.log(`✅ Solana action logged (not implemented)`);
  } catch (error) {
    console.error('❌ Solana action failed:', error);
    throw error;
  }
}

// Process all actions for a zap immediately
async function processZapImmediately(zapId: string, triggerPayload: any, zapRunId?: string) {
  try {
    // Get zap with all actions
    const zap = await client.zap.findUnique({
      where: { id: zapId },
      include: {
        actions: {
          include: { action: true },
          orderBy: { sortingOrder: 'asc' },
        },
      },
    });

    if (!zap) {
      console.error(`Zap not found: ${zapId}`);
      if (zapRunId) {
        await client.zapRun.update({
          where: { id: zapRunId },
          data: { status: 'failed', errorMessage: 'Zap not found', completedAt: new Date() },
        });
      }
      return { success: false, error: 'Zap not found' };
    }

    if (!zap.isActive) {
      console.log(`Zap is inactive: ${zapId}`);
      return { success: false, error: 'Zap is inactive' };
    }

    console.log(`🚀 Processing zap: ${zap.name} (${zap.actions.length} actions)`);

    // Execute each action in order
    for (const action of zap.actions) {
      await executeAction(action, action.metadata, triggerPayload);
    }

    if (zapRunId) {
      await client.zapRun.update({
        where: { id: zapRunId },
        data: { status: 'completed', completedAt: new Date() },
      });
    }

    console.log(`✅ Zap completed: ${zap.name}`);
    return { success: true, actionsExecuted: zap.actions.length };
  } catch (error) {
    console.error('❌ Zap processing failed:', error);
    if (zapRunId) {
      await client.zapRun.update({
        where: { id: zapRunId },
        data: { status: 'failed', errorMessage: String(error), completedAt: new Date() },
      });
    }
    return { success: false, error: String(error) };
  }
}

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'hooks' });
});

// Main webhook endpoint - IMMEDIATE PROCESSING
app.post('/hooks/:userId/:zapId', async (req: Request, res: Response) => {
  const { zapId, userId } = req.params;
  const triggerPayload = req.body;

  if (!zapId) {
    res.status(400).json({ message: 'Zap ID is required' });
    return;
  }

  console.log(`📨 Webhook received for zap: ${zapId}`);

  try {
    // Create ZapRun record for history
    const zapRun = await client.zapRun.create({
      data: {
        zapId: zapId as string,
        metadata: triggerPayload,
      },
    });

    console.log(`📝 ZapRun created: ${zapRun.id}`);

    // Process immediately (non-blocking)
    processZapImmediately(zapId as string, triggerPayload, zapRun.id)
      .then((result) => {
        console.log(`📊 Zap result:`, result);
      })
      .catch((error) => {
        console.error(`❌ Background processing error:`, error);
      });

    // Respond immediately
    res.status(201).json({
      message: 'Hook triggered - processing started',
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
    // Get the ZapRun with its Zap
    const zapRun = await client.zapRun.findUnique({
      where: { id: zapRunId },
      include: { zap: true },
    });

    if (!zapRun) {
      return res.status(404).json({ error: 'ZapRun not found' });
    }

    // Process immediately
    const triggerPayload = (zapRun.metadata as Record<string, any>) || {};

    processZapImmediately(zapRun.zapId, triggerPayload, zapRunId)
      .then((result) => {
        console.log(`📊 Schedule Zap result:`, result);
      })
      .catch((error) => {
        console.error(`❌ Schedule processing error:`, error);
      });

    res.status(200).json({
      success: true,
      message: 'Schedule processing started',
      zapRunId,
    });
  } catch (error: any) {
    console.error('Schedule webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// JSON parsing error handler (must be after routes)
app.use((err: any, req: any, res: any, next: any) => {
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
  console.log(`🚀 Hooks service running on port ${PORT} (IMMEDIATE MODE)`);
});
