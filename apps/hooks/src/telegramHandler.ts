import { Request, Response } from 'express';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';

interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    is_bot: boolean;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  date: number;
  text?: string;
  entities?: { type: string; offset: number; length: number }[];
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    data: string;
    message?: TelegramMessage;
  };
}

/**
 * Handle incoming Telegram webhook updates
 */
export async function handleTelegramWebhook(req: Request, res: Response): Promise<any> {
  try {
    const update: TelegramUpdate = req.body;

    // Always respond 200 quickly to prevent Telegram retries
    res.sendStatus(200);

    // Every bot used to share one webhook URL, so a message could not be
    // attributed to a bot and was fanned out to every tenant's triggers.
    // The URL registered by setWebhook now carries the bot id.
    const botId = typeof req.params?.botId === 'string' ? req.params.botId : '';
    if (!botId) {
      console.warn(
        'Ignoring Telegram update without a bot id; re-register the bot webhook (/api/webhooks/telegram/:botId)'
      );
      return;
    }

    // Process message updates
    if (update.message) {
      await processMessage(botId, update.message);
    }

    // Process edited messages
    if (update.edited_message) {
      console.log(`📝 Telegram edited message from ${update.edited_message.from.first_name}`);
      // Optionally handle edits
    }

    // Process callback queries (button clicks)
    if (update.callback_query) {
      console.log(`🔘 Telegram callback: ${update.callback_query.data}`);
      // Handle button clicks if needed
    }
  } catch (error) {
    console.error('Telegram webhook error:', error);
    // Still return 200 to prevent retries - we log the error internally
  }
}

/**
 * Process incoming Telegram message and trigger Zaps
 */
export async function processMessage(botId: string, message: TelegramMessage): Promise<void> {
  console.log(
    `📨 Telegram message from ${message.from.first_name} (@${message.from.username || 'no-username'}): ${message.text || '[no text]'}`
  );

  // Detect if it's a command (starts with /)
  const isCommand = message.text?.startsWith('/') || false;
  const command = isCommand ? message.text!.split(' ')[0].split('@')[0] : null;
  const commandArgs = isCommand ? message.text!.slice(command!.length).trim() : null;

  // Only triggers belonging to the bot that received this update.
  const triggers = await client.telegramTrigger.findMany({
    where: {
      isActive: true,
      bot: { id: botId, isActive: true },
      // Filter by command if the trigger has a filter set
      OR: [
        { filterCommand: null }, // No filter - match all
        { filterCommand: '' }, // Empty filter - match all
        { filterCommand: command || '___never_match___' }, // Specific command filter
      ],
    },
    include: {
      bot: true,
    },
  });

  if (triggers.length === 0) {
    console.log('No active Telegram triggers found');
    return;
  }

  console.log(`Found ${triggers.length} active Telegram trigger(s)`);

  for (const trigger of triggers) {
    if (!trigger.zapId) continue;

    // The run-intake module owns the active-Zap decision.
    const zap = await client.zap.findFirst({ where: { id: trigger.zapId } });

    if (!zap) continue;

    const result = await enqueueRun({
      zapId: zap.id,
      source: 'hooks.telegram',
      dedup: { scope: 'telegram', key: `${botId}:${zap.id}:${message.message_id}` },
      metadata: {
        // Sender info
        userId: message.from.id,
        firstName: message.from.first_name,
        lastName: message.from.last_name || '',
        username: message.from.username || '',
        isBot: message.from.is_bot,
        // Chat info
        chatId: message.chat.id,
        chatType: message.chat.type,
        chatTitle: message.chat.title || message.chat.first_name || '',
        // Message info
        messageId: message.message_id,
        text: message.text || '',
        isCommand: isCommand,
        command: command,
        commandArgs: commandArgs,
        timestamp: message.date,
        // For reply functionality
        replyToChatId: message.chat.id,
        // Useful placeholder for other actions
        email: `${message.from.username || message.from.id}@telegram.placeholder`,
      },
    });

    if (result.status !== 'queued') {
      // Only a real run advances the trigger clock; a duplicate replay or an
      // inactive Zap must leave it untouched (same as the previous ingress).
      console.log(`🔁 Telegram ${result.status} — no run for Zap "${zap.name}"`);
      continue;
    }

    // Update last processed time
    await client.telegramTrigger.update({
      where: { id: trigger.id },
      data: { lastProcessedAt: new Date() },
    });

    console.log(`✅ Telegram ZapRun queued: ${result.zapRunId} for Zap "${zap.name}"`);
  }
}
