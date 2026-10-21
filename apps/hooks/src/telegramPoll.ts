/**
 * Telegram getUpdates polling fallback — T7 Q-TG-T-02.
 *
 * setWebhook is the preferred transport; this path covers deployments with
 * no public HTTPS endpoint. Bots with `webhookConfigured: true` are never
 * polled (Telegram answers getUpdates with 409 while a webhook is set).
 *
 * Offset discipline (Q-TG-T-05 at-least-once): the stored offset advances
 * only when every update in the batch processed cleanly — a failure keeps
 * the offset so Telegram redelivers, and the shared update_id dedupe key
 * (same scope/key as the webhook path) prevents double execution.
 *
 * Error classes: 401 → auth-class log + skip bot; 429 → honor
 * retry_after by leaving the offset untouched (next cron run); 409 →
 * webhook conflict, skip.
 */

// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';
import { processMessage } from './telegramHandler';

const TELEGRAM_API = 'https://api.telegram.org/bot';

const offsetKey = (botId: string) => `telegram:offset:${botId}`;

export interface TelegramPollResult {
  botsConsidered: number;
  botsPolled: number;
  updatesProcessed: number;
  errors: number;
}

export async function pollTelegramBots(): Promise<TelegramPollResult> {
  const result: TelegramPollResult = {
    botsConsidered: 0,
    botsPolled: 0,
    updatesProcessed: 0,
    errors: 0,
  };

  // Polling fallback only where the webhook is not registered.
  const bots = await client.telegramBot.findMany({
    where: { isActive: true, webhookConfigured: false },
  });
  result.botsConsidered = bots.length;

  for (const bot of bots) {
    try {
      const offset = Number(await redis.get(offsetKey(bot.id))) || 0;
      const url =
        `${TELEGRAM_API}${bot.botToken}/getUpdates` +
        `?offset=${offset}&timeout=0&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`;

      const resp = await fetch(url, { method: 'GET' });

      if (resp.status === 401) {
        console.error(`🔒 Telegram poll: bot "${bot.botName}" has an invalid token (401) — auth-class, skipping`);
        result.errors++;
        continue;
      }
      if (resp.status === 429) {
        const retryAfter = resp.headers.get('retry-after');
        console.warn(
          `⏳ Telegram poll: rate limited (429), retry_after=${retryAfter ?? 'unknown'}s — offset held, will retry next sweep`
        );
        result.errors++;
        continue;
      }
      if (resp.status === 409) {
        console.warn(
          `⚠️ Telegram poll: conflict (409) — a webhook is registered for "${bot.botName}"; skipping polling for this bot`
        );
        continue;
      }
      if (!resp.ok) {
        console.error(`⚠️ Telegram poll: getUpdates failed with ${resp.status} for "${bot.botName}"`);
        result.errors++;
        continue;
      }

      const data = await resp.json();
      if (!data?.ok) {
        const retryAfter = data?.parameters?.retry_after;
        if (retryAfter) {
          console.warn(
            `⏳ Telegram poll: API asked retry_after=${retryAfter}s for "${bot.botName}" — offset held`
          );
          result.errors++;
          continue;
        }
        console.error(
          `⚠️ Telegram poll: getUpdates error for "${bot.botName}": ${data?.description || 'unknown'}`
        );
        result.errors++;
        continue;
      }

      const updates: any[] = Array.isArray(data.result) ? data.result : [];
      result.botsPolled++;

      let nextOffset = offset;
      let allOk = true;

      for (const update of updates) {
        nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
        if (update.message) {
          try {
            await processMessage(bot.id, update.update_id, update, update.message);
            result.updatesProcessed++;
          } catch (error) {
            allOk = false;
            console.error(
              `Telegram poll: failed processing update ${update_update_label(update)} — offset held for redelivery`
            );
            result.errors++;
          }
        }
      }

      // Advance the offset only when the whole batch processed cleanly;
      // failures keep it so Telegram redelivers and update_id dedupes.
      if (allOk) {
        await redis.set(offsetKey(bot.id), nextOffset);
      }
    } catch (error) {
      result.errors++;
      console.error(`Telegram poll error for bot "${bot.botName}":`, error);
    }
  }

  return result;
}

function update_update_label(update: any): string {
  return String(update?.update_id ?? '?');
}
