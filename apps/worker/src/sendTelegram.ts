/**
 * A6 — Telegram Send action (docs/ask-matt/actions/telegram.md, grilled
 * round 16).
 *
 * Q-TG-A-01 text + photo/document with caption · Q-TG-A-02 parse mode off by
 * default (HTML / MarkdownV2 selectable) · Q-TG-A-03 numeric ids or @usernames ·
 * Q-TG-A-04 over-limit fails loudly (no truncation, no auto-split) ·
 * Q-TG-A-05 link-preview off by default, silent + reply-to supported.
 *
 * The bot token comes from the shared TelegramBot connection (same one T7 uses
 * for the trigger) and is never logged or echoed.
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';
const REQUEST_TIMEOUT_MS = 10_000;
export const TEXT_LIMIT = 4096;
export const CAPTION_LIMIT = 1024;

export type TelegramErrorCode =
  | 'validation'
  | 'message_too_long'
  | 'caption_too_long'
  | 'chat_not_found'
  | 'parse_error'
  | 'media_fetch_failed'
  | 'auth'
  | 'forbidden'
  | 'rate_limited'
  | 'conflict'
  | 'provider';

export class TelegramActionError extends Error {
  constructor(
    message: string,
    public readonly code: TelegramErrorCode,
    public readonly retryable = false,
    public readonly retryAfter?: number
  ) {
    super(message);
    this.name = 'TelegramActionError';
  }
}

export interface TelegramBotRow {
  id: string;
  botToken: string;
  botUsername: string;
}

export interface TelegramDb {
  telegramBot: { findFirst: (args: any) => Promise<any> };
}

export interface TelegramOutput {
  sent: true;
  messageId: number;
  chat: { id: number | string; type?: string; title?: string };
  date: number;
  text: string;
  apiResponse: { ok: boolean };
  error: null;
}

export interface TelegramDeps {
  fetchImpl?: typeof fetch;
  db?: TelegramDb;
}

function parseMetadata(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new TelegramActionError('Telegram action metadata must be an object', 'validation');
  return raw as Record<string, any>;
}

function template(value: unknown, run: Record<string, unknown>): string {
  if (typeof value !== 'string') return value === undefined || value === null ? '' : String(value);
  return value.replace(
    /\{\{\s*([^{}]+?)\s*\}\}|\{([^{}]+?)\}/g,
    (match: string, doubleKey?: string, singleKey?: string) => {
      const key = String(doubleKey ?? singleKey ?? '').trim();
      let current: any = run;
      for (const part of key.split('.')) {
        if (current && typeof current === 'object' && part in current) current = current[part];
        else return match;
      }
      return current !== undefined && current !== null ? String(current) : match;
    }
  );
}

/** Q-TG-A-03: numeric chat/user id (groups/channels may be negative) or @username. */
export function normalizeChatTarget(raw: unknown): string | number {
  const value = String(raw ?? '').trim();
  if (!value) throw new TelegramActionError('A chat id or @username is required', 'validation');
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^@[A-Za-z0-9_]{5,32}$/.test(value)) return value;
  throw new TelegramActionError(
    `Invalid chat target "${value}" — use a numeric chat id (e.g. -1001234567890) or an @username`,
    'validation'
  );
}

/** Q-TG-A-02: parse mode is OFF unless the step opts in. */
export function normalizeParseMode(raw: unknown): string | undefined {
  const value = String(raw ?? '').trim();
  if (!value || value.toLowerCase() === 'none') return undefined;
  if (value === 'HTML' || value === 'MarkdownV2') return value;
  throw new TelegramActionError(
    `Unsupported parse mode "${value}" — use none (default), HTML or MarkdownV2`,
    'validation'
  );
}

/** Q-TG-A-04: fail loudly instead of truncating or auto-splitting. */
export function assertLengths(text: string, caption: string): void {
  if (text.length > TEXT_LIMIT)
    throw new TelegramActionError(
      `message_too_long: the message is ${text.length} characters — Telegram allows ${TEXT_LIMIT}. ` +
        'Shorten it or split the step; text is never truncated automatically.',
      'message_too_long'
    );
  if (caption.length > CAPTION_LIMIT)
    throw new TelegramActionError(
      `caption_too_long: the caption is ${caption.length} characters — Telegram allows ${CAPTION_LIMIT}`,
      'caption_too_long'
    );
}

async function resolveBot(
  metadata: Record<string, any>,
  userId: number,
  db: TelegramDb
): Promise<TelegramBotRow> {
  const botId = String(metadata.botId ?? '').trim();
  const bot = await db.telegramBot.findFirst({
    where: { ...(userId ? { userId } : {}), isActive: true, ...(botId ? { id: botId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  if (!bot)
    throw new TelegramActionError(
      botId
        ? `Bot ${botId} is not one of this account's connected bots — pick a bot from the connection`
        : 'No active Telegram bot for this account — connect a bot first',
      'auth'
    );
  return bot as TelegramBotRow;
}

/** Media sources are verified before sending (URL) or must be a file_id. */
export async function assertMediaSource(
  source: string,
  fetchImpl: typeof fetch
): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response | undefined;
    try {
      response = await fetchImpl(source, { method: 'HEAD', signal: controller.signal });
      if (response.status === 405 || response.status === 501)
        response = await fetchImpl(source, { method: 'GET', signal: controller.signal });
    } catch {
      response = undefined;
    } finally {
      clearTimeout(timer);
    }
    if (!response || !response.ok)
      throw new TelegramActionError(
        `media_fetch_failed: ${source} is unreachable${response ? ` (HTTP ${response.status})` : ''}`,
        'media_fetch_failed'
      );
    return source;
  }
  if (!source.trim())
    throw new TelegramActionError('Media needs a URL or a file_id', 'validation');
  return source; // stable file_id
}

function classifyTelegramError(status: number, body: any): TelegramActionError {
  const description = String(body?.description ?? '');
  const lower = description.toLowerCase();
  const retryAfter = Number(body?.parameters?.retry_after ?? NaN);

  if (status === 401 || /unauthorized/.test(lower))
    return new TelegramActionError(
      'Telegram rejected the bot token — reconnect the bot (token redacted)',
      'auth'
    );
  if (status === 403)
    return new TelegramActionError(
      'forbidden: the bot cannot post here. Add the bot as a member/admin of the group or ' +
        'channel, and for DMs the user must start the bot first.',
      'forbidden'
    );
  if (status === 400 && /chat not found/.test(lower))
    return new TelegramActionError(
      `chat_not_found: Telegram could not find that chat (${description})`,
      'chat_not_found'
    );
  if (status === 400 && /parse|entity|markdown|html/.test(lower))
    return new TelegramActionError(
      `parse_error: Telegram rejected the ${'markup'} — ${description}`,
      'parse_error'
    );
  if (status === 429)
    return new TelegramActionError(
      `rate_limited: Telegram asked to wait ${Number.isFinite(retryAfter) ? retryAfter : 'a few'} ` +
        'seconds before retrying',
      'rate_limited',
      true,
      Number.isFinite(retryAfter) ? retryAfter : undefined
    );
  if (status === 409)
    return new TelegramActionError(
      'conflict: another webhook or polling process owns this bot (409) — stop the competing ' +
        'process (getUpdates vs setWebhook) and retry',
      'conflict'
    );
  if (status === 400) return new TelegramActionError(`Telegram rejected the request: ${description}`, 'validation');
  return new TelegramActionError(
    `Telegram send failed (HTTP ${status})${description ? `: ${description}` : ''}`,
    'provider',
    status >= 500
  );
}

const redactToken = (text: string, token: string) =>
  token ? text.split(token).join('<bot-token>') : text;

/**
 * Send one Telegram message (text, photo or document). API acceptance is
 * success; the returned chat/date come from Telegram's own response.
 */
export async function sendTelegramAction(
  rawMetadata: unknown,
  runMetadata: Record<string, unknown> = {},
  deps: TelegramDeps = {}
): Promise<TelegramOutput> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const db: TelegramDb = deps.db ?? ((await import('@repo/db')).default as unknown as TelegramDb);

  const metadata = parseMetadata(rawMetadata);
  const userId = Number((runMetadata as any)?.userId ?? (runMetadata as any)?.zap?.userId ?? 0) || 0;
  const bot = await resolveBot(metadata, userId, db);

  const chatTarget = normalizeChatTarget(template(metadata.chatId ?? metadata.chat, runMetadata));
  const parseMode = normalizeParseMode(metadata.parseMode);

  const text = template(metadata.text ?? metadata.message ?? '', runMetadata).trim();
  const mediaConfig = metadata.media;
  let media: { kind: 'photo' | 'document'; source: string; caption: string } | undefined;
  if (mediaConfig) {
    const kind = String(mediaConfig.kind ?? 'photo').toLowerCase();
    if (!['photo', 'document'].includes(kind))
      throw new TelegramActionError(
        `Unsupported media kind "${kind}" — v1 supports photo and document`,
        'validation'
      );
    const source = template(mediaConfig.source ?? '', runMetadata).trim();
    if (!source) throw new TelegramActionError('Media needs a URL or a file_id', 'validation');
    media = {
      kind: kind as 'photo' | 'document',
      source: await assertMediaSource(source, fetchImpl),
      caption: template(mediaConfig.caption ?? '', runMetadata).trim(),
    };
  }

  if (!text && !media)
    throw new TelegramActionError('A message needs text or media', 'validation');

  assertLengths(media ? media.caption : text, media ? media.caption : '');

  const replyTo = metadata.replyToMessageId;
  const payload: Record<string, any> = {
    chat_id: chatTarget,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    ...(metadata.silent ? { disable_notification: true } : {}),
    ...(replyTo !== undefined && replyTo !== null && String(replyTo).trim() !== ''
      ? { reply_to_message_id: Number(replyTo) }
      : {}),
  };

  let method: string;
  let outboundText = text;
  if (media) {
    method = media.kind === 'photo' ? 'sendPhoto' : 'sendDocument';
    payload[media.kind] = media.source;
    if (media.caption) payload.caption = media.caption;
    outboundText = media.caption;
  } else {
    method = 'sendMessage';
    payload.text = text;
    // Q-TG-A-05: link previews are OFF unless the step enables them.
    payload.link_preview_options = { is_disabled: !metadata.linkPreview };
  }

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetchImpl(`${TELEGRAM_API}${bot.botToken}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const timedOut = (error as Error)?.name === 'AbortError';
    throw new TelegramActionError(
      timedOut ? 'Telegram request timed out' : 'Telegram send failed: network error',
      'provider',
      true
    );
  }

  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const classified = classifyTelegramError(response.status, body);
    classified.message = redactToken(classified.message, bot.botToken);
    throw classified;
  }

  const result = body?.result ?? {};
  const messageId = Number(result.message_id ?? NaN);
  if (!Number.isFinite(messageId))
    throw new TelegramActionError('Telegram accepted the request but returned no message id', 'provider', true);

  return {
    sent: true,
    messageId,
    chat: {
      id: result.chat?.id ?? chatTarget,
      ...(result.chat?.type ? { type: result.chat.type } : {}),
      ...(result.chat?.title ? { title: result.chat.title } : {}),
    },
    date: Number(result.date ?? Math.floor(Date.now() / 1000)),
    text: outboundText,
    apiResponse: { ok: Boolean(body.ok) },
    error: null,
  };
}
