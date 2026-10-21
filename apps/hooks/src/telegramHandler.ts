import { Request, Response } from 'express';
import client from '@repo/db';
import { enqueueRun } from '@repo/runs';
import { verifyTelegram } from '@repo/ingress';

/**
 * Telegram inbound — T7 spec (docs/ask-matt/triggers/telegram.md, round 9).
 *
 * - Q-TG-T-01: `message` updates ONLY (edited/channel/callback logged and
 *   dropped — E2–E4 backlog).
 * - Q-TG-T-02 transport: setWebhook preferred (secret-token header validated
 *   when TELEGRAM_WEBHOOK_SECRET configured) + getUpdates polling fallback
 *   (see telegramPoll.ts).
 * - Q-TG-T-03: per-Zap chat-type filter from Trigger.metadata.chatTypes
 *   (multi-select private/group/channel; supergroup matches group; absent
 *   or empty = no restriction).
 * - Q-TG-T-04: media metadata only — media{type,fileId,uniqueId,mimeType,
 *   caption}; content fetch is backlog.
 * - Q-TG-T-05: dedupe on `update_id` (webhook + polling share the same
 *   scope/key), at-least-once — failures leave the delivery un-acked so
 *   Telegram redelivers and the dedupe absorbs replays.
 * - §4 contract with legacy flat aliases kept (userId/chatId/chatType/
 *   command fields/email placeholder); `text` now follows the spec
 *   (null for non-text messages, was '').
 */

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    is_bot?: boolean;
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
  caption?: string;
  entities?: { type: string; offset: number; length: number }[];
  reply_to_message?: { message_id: number };
  photo?: any;
  video?: any;
  document?: any;
  audio?: any;
  voice?: any;
  sticker?: any;
  animation?: any;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: any;
}

const MEDIA_KINDS = ['photo', 'video', 'document', 'audio', 'voice', 'sticker', 'animation'] as const;

/**
 * §4 data contract (+ legacy aliases). `raw` is the full update so future
 * update types stay visible for debugging (§4).
 */
export function buildTelegramRunPayload(
  update: TelegramUpdate,
  message: TelegramMessage
): Record<string, any> {
  const text = typeof message.text === 'string' ? message.text : null;
  const isCommand = text?.startsWith('/') || false;
  const command = isCommand ? (text!.split(' ')[0] || '').split('@')[0] || null : null;
  const commandArgs = isCommand ? text!.slice(command!.length).trim() : null;

  const mediaKind = MEDIA_KINDS.find((k) => message[k]);
  const mediaBlockRaw = mediaKind ? message[mediaKind] : null;
  // Telegram sends photo sizes as an array — the last entry is the largest.
  const mediaBlock = Array.isArray(mediaBlockRaw)
    ? mediaBlockRaw[mediaBlockRaw.length - 1]
    : mediaBlockRaw;
  const media = mediaBlock
    ? {
        type: mediaKind,
        fileId: mediaBlock.file_id ?? null,
        uniqueId: mediaBlock.file_unique_id ?? null,
        mimeType: mediaBlock.mime_type ?? null,
        // Telegram carries caption at message level; some kinds embed it.
        caption: message.caption ?? mediaBlock.caption ?? null,
      }
    : null;

  const chat = message.chat;
  const from = message.from;

  return {
    // Spec contract (§4)
    updateId: update.update_id,
    messageId: message.message_id,
    chat: {
      id: chat?.id ?? null,
      type: chat?.type ?? null,
      title: chat?.title ?? null,
      username: chat?.username ?? null,
    },
    from: {
      id: from?.id ?? null,
      isBot: from?.is_bot ?? false,
      firstName: from?.first_name ?? '',
      lastName: from?.last_name ?? null,
      username: from?.username ?? null,
    },
    date: message.date,
    text,
    entities: message.entities ?? null,
    media,
    replyToMessageId: message.reply_to_message?.message_id ?? null,
    raw: update,
    // Legacy aliases (existing templates/filters depend on these)
    userId: from?.id ?? null,
    firstName: from?.first_name || '',
    lastName: from?.last_name || '',
    username: from?.username || '',
    isBot: from?.is_bot ?? false,
    chatId: chat?.id ?? null,
    chatType: chat?.type ?? '',
    chatTitle: chat?.title || chat?.first_name || '',
    isCommand,
    command,
    commandArgs,
    timestamp: message.date,
    replyToChatId: chat?.id ?? null,
    email: `${from?.username || from?.id}@telegram.placeholder`,
  };
}

/**
 * Q-TG-T-03 chat-type filter: absent/empty metadata.chatTypes = no
 * restriction; supergroup normalizes to group for matching.
 */
export function matchesChatTypeFilter(
  message: TelegramMessage,
  chatTypes: unknown
): boolean {
  if (!Array.isArray(chatTypes) || chatTypes.length === 0) return true;
  const raw = message?.chat?.type;
  const normalized = raw === 'supergroup' ? 'group' : raw;
  return chatTypes.map((t) => String(t)).includes(String(normalized));
}

/**
 * Mandatory secret-token check (Q-TG-T-02).
 *
 * This used to return `true` when TELEGRAM_WEBHOOK_SECRET was unset, so an
 * unconfigured deployment accepted any webhook delivery — the accidental
 * fail-open closed by `@repo/ingress` (ADR-0002). A bot whose webhook is
 * registered without a secret token must now be configured before it can run.
 */
export function verifyTelegramSecretHeader(
  headers: Record<string, string | string[] | undefined>
): boolean {
  return verifyTelegram({ headers }, process.env.TELEGRAM_WEBHOOK_SECRET).ok;
}

/**
 * Handle incoming Telegram webhook updates.
 * Verified secret first; runs are enqueued BEFORE the 200 ack so a failure
 * surfaces as non-2xx → Telegram redelivers → update_id dedupe guarantees
 * single execution (at-least-once, Q-TG-T-05).
 */
export async function handleTelegramWebhook(req: Request, res: Response): Promise<any> {
  try {
    const botId = typeof req.params?.botId === 'string' ? req.params.botId : '';
    if (!botId) {
      console.warn(
        'Ignoring Telegram update without a bot id; re-register the bot webhook (/api/webhooks/telegram/:botId)'
      );
      return res.sendStatus(200);
    }

    if (!verifyTelegramSecretHeader(req.headers)) {
      console.error('🔒 Telegram security: rejected delivery — invalid secret token');
      return res.status(401).json({ error: 'Invalid secret token' });
    }

    const update: TelegramUpdate = req.body;

    if (update?.message) {
      await processMessage(botId, update.update_id, update, update.message);
    } else if (update?.edited_message) {
      console.log(`📝 Telegram edited message from ${update.edited_message.from?.first_name}`);
      // E2 backlog — ack, no run
    } else if (update?.callback_query) {
      console.log(`🔘 Telegram callback: ${update.callback_query.data}`);
      // E4 backlog — ack, no run
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('Telegram webhook error:', error);
    // Non-2xx → Telegram redelivers later; update_id dedupe absorbs replays.
    return res.status(500).json({ error: 'Processing failed' });
  }
}

/**
 * Process one message update and fan out to matching Zaps (shared by the
 * webhook path and the getUpdates polling fallback).
 */
export async function processMessage(
  botId: string,
  updateId: number,
  update: TelegramUpdate | undefined,
  message: TelegramMessage
): Promise<void> {
  console.log(
    `📨 Telegram message from ${message.from?.first_name || '?'} (@${message.from?.username || 'no-username'}): ${message.text || '[no text]'}`
  );

  // Command detection (kept: legacy per-trigger filterCommand feature)
  const isCommand = message.text?.startsWith('/') || false;
  const command = isCommand ? (message.text!.split(' ')[0] || '').split('@')[0] || null : null;

  // Only triggers belonging to the bot that received this update.
  const triggers = await client.telegramTrigger.findMany({
    where: {
      isActive: true,
      bot: { id: botId, isActive: true },
      // Filter by command if the trigger has a filter set (legacy extra)
      OR: [
        { filterCommand: null },
        { filterCommand: '' },
        { filterCommand: command || '___never_match___' },
      ],
    },
    include: {
      bot: true,
      zap: { include: { trigger: true } },
    },
  });

  if (triggers.length === 0) {
    console.log('No active Telegram triggers found');
    return;
  }

  console.log(`Found ${triggers.length} active Telegram trigger(s)`);

  for (const trigger of triggers) {
    if (!trigger.zapId) continue;

    // Q-TG-T-03: chat-type filter from Trigger.metadata.chatTypes.
    const chatTypes = (trigger as any).zap?.trigger?.metadata?.chatTypes;
    if (!matchesChatTypeFilter(message, chatTypes)) {
      console.log(
        `🚫 Telegram chat type "${message.chat.type}" outside filter [${(Array.isArray(chatTypes) ? chatTypes : []).join(', ')}] — dropped`
      );
      continue;
    }

    // The run-intake module owns the active-Zap decision.
    const zap = await client.zap.findFirst({ where: { id: trigger.zapId } });
    if (!zap) continue;

    const result = await enqueueRun({
      zapId: zap.id,
      source: 'hooks.telegram',
      // Q-TG-T-05: dedupe on update_id — webhook + polling share this key.
      dedup: { scope: 'telegram', key: `${botId}:${zap.id}:${updateId}` },
      metadata: buildTelegramRunPayload(
        update ?? ({ update_id: updateId, message } as TelegramUpdate),
        message
      ),
    });

    if (result.status !== 'queued') {
      // Only a real run advances the trigger clock.
      console.log(`🔁 Telegram ${result.status} — no run for Zap "${(zap as any).name}"`);
      continue;
    }

    await client.telegramTrigger.update({
      where: { id: trigger.id },
      data: { lastProcessedAt: new Date() },
    });

    console.log(`✅ Telegram ZapRun queued: ${result.zapRunId} for Zap "${(zap as any).name}"`);
  }
}
