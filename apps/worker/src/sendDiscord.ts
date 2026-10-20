import axios from 'axios';
import { replaceKeys } from './utils/replaceKeys';

// Canonical Discord incoming webhook URL pattern (anchored, canonical domains only)
const DISCORD_WEBHOOK_REGEX = /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

// Bound every outbound call: a stalled Discord connection must not block the worker.
const REQUEST_TIMEOUT_MS = 10_000;

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number | string;
  timestamp?: string;
  fields?: DiscordEmbedField[];
}

export interface DiscordMessageOptions {
  content?: string;
  username?: string;
  avatarUrl?: string;
  embed?: DiscordEmbed;
}

export interface DiscordMessageResult {
  success: boolean;
  messageId?: string;
  timestamp?: string;
  isFatal?: boolean;
  error?: string;
}

/**
 * Validate that a URL is a valid Discord incoming webhook endpoint.
 */
export function isValidDiscordWebhookUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  return DISCORD_WEBHOOK_REGEX.test(url.trim());
}

/**
 * Convert a hex color string (e.g. "#5865F2", "#000000") or numeric color to decimal integer.
 * Pure black (#000000 -> 0) is preserved as a valid Discord color.
 */
export function normalizeDiscordColor(color?: string | number): number | undefined {
  if (color === undefined || color === null || color === '') return undefined;
  if (typeof color === 'number') {
    return Number.isFinite(color) ? Math.max(0, Math.min(16777215, Math.floor(color))) : undefined;
  }
  const cleanHex = String(color).replace(/^#/, '').trim();
  if (!cleanHex) return undefined;
  const parsed = parseInt(cleanHex, 16);
  return Number.isNaN(parsed) ? undefined : Math.max(0, Math.min(16777215, parsed));
}

/**
 * Recursively interpolate dynamic placeholders in Discord message options.
 */
export function resolveDiscordPlaceholders(
  options: DiscordMessageOptions,
  metadata: Record<string, any>
): DiscordMessageOptions {
  if (!metadata || typeof metadata !== 'object') return options;

  const resolved: DiscordMessageOptions = {
    ...options,
    content: options.content ? replaceKeys(options.content, metadata) : undefined,
    username: options.username ? replaceKeys(options.username, metadata) : undefined,
    avatarUrl: options.avatarUrl ? replaceKeys(options.avatarUrl, metadata) : undefined,
  };

  if (options.embed) {
    resolved.embed = {
      ...options.embed,
      title: options.embed.title ? replaceKeys(options.embed.title, metadata) : undefined,
      description: options.embed.description ? replaceKeys(options.embed.description, metadata) : undefined,
      url: options.embed.url ? replaceKeys(options.embed.url, metadata) : undefined,
      timestamp: options.embed.timestamp ? replaceKeys(options.embed.timestamp, metadata) : undefined,
      fields: options.embed.fields
        ?.map((field) => ({
          name: replaceKeys(String(field.name || ''), metadata).trim().slice(0, 256),
          value: replaceKeys(String(field.value || ''), metadata).trim().slice(0, 1024),
          inline: field.inline,
        }))
        .filter((field) => field.name.length > 0 && field.value.length > 0)
        .slice(0, 25),
    };
  }

  return resolved;
}

/**
 * Send a message or rich embed via Discord Incoming Webhook.
 */
export async function sendDiscordMessage(
  webhookUrl: string,
  options: DiscordMessageOptions
): Promise<DiscordMessageResult> {
  const trimmedUrl = (webhookUrl || '').trim();
  if (!isValidDiscordWebhookUrl(trimmedUrl)) {
    return {
      success: false,
      isFatal: true,
      error: 'Invalid Discord webhook URL. Must match https://discord.com/api/webhooks/{id}/{token}',
    };
  }

  const { content, username, avatarUrl, embed } = options;

  let resolvedEmbed: Record<string, any> | undefined = undefined;
  if (embed && typeof embed === 'object') {
    let resolvedTimestamp: string | undefined = undefined;
    if (embed.timestamp === 'now') {
      resolvedTimestamp = new Date().toISOString();
    } else if (typeof embed.timestamp === 'string' && embed.timestamp.trim().length > 0) {
      const trimmed = embed.timestamp.trim();
      const parsedMs = Date.parse(trimmed);
      if (!Number.isNaN(parsedMs)) {
        resolvedTimestamp = new Date(parsedMs).toISOString();
      }
    }

    const sanitizedFields = Array.isArray(embed.fields)
      ? embed.fields
          .filter((f) => f && String(f.name || '').trim().length > 0 && String(f.value || '').trim().length > 0)
          .slice(0, 25)
          .map((f) => ({
            name: String(f.name).trim().slice(0, 256),
            value: String(f.value).trim().slice(0, 1024),
            inline: Boolean(f.inline),
          }))
      : undefined;

    const hasValidTitle = typeof embed.title === 'string' && embed.title.trim().length > 0;

    resolvedEmbed = {
      title: hasValidTitle ? String(embed.title).slice(0, 256) : undefined,
      description: embed.description ? String(embed.description).slice(0, 4096) : undefined,
      color: normalizeDiscordColor(embed.color),
      url: hasValidTitle && embed.url ? String(embed.url).trim() || undefined : undefined,
      timestamp: resolvedTimestamp,
      fields: sanitizedFields && sanitizedFields.length > 0 ? sanitizedFields : undefined,
    };

    // Remove undefined properties
    Object.keys(resolvedEmbed).forEach((key) => {
      if (resolvedEmbed![key] === undefined) {
        delete resolvedEmbed![key];
      }
    });
  }

  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasEmbedContent =
    resolvedEmbed !== undefined &&
    Boolean(
      (resolvedEmbed.title && resolvedEmbed.title.trim().length > 0) ||
      (resolvedEmbed.description && resolvedEmbed.description.trim().length > 0) ||
      (Array.isArray(resolvedEmbed.fields) && resolvedEmbed.fields.length > 0)
    );

  if (!hasContent && !hasEmbedContent) {
    return {
      success: false,
      isFatal: true,
      error: 'Either content or embed (with title, description, or fields) is required to send a Discord message.',
    };
  }

  const payload: Record<string, any> = {};

  if (hasContent) {
    // Discord max message content is 2,000 characters
    payload.content = content!.slice(0, 2000);
  }

  if (hasEmbedContent) {
    payload.embeds = [resolvedEmbed];
  }

  if (username && typeof username === 'string') {
    payload.username = username.slice(0, 80);
  }

  if (avatarUrl && typeof avatarUrl === 'string') {
    payload.avatar_url = avatarUrl;
  }

  const url = new URL(trimmedUrl);
  url.searchParams.set('wait', 'true');
  const targetUrl = url.toString();

  const maxAttempts = 4; // 1 initial attempt + 3 retries (spec line 86)
  let lastErrorMsg = 'Unknown Discord error';

  for (let attempt = 1; ; attempt++) {
    try {
      const response = await axios.post(targetUrl, payload, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const messageId = response.data?.id ? String(response.data.id) : undefined;
      const timestamp = response.data?.timestamp ? String(response.data.timestamp) : undefined;
      return {
        success: true,
        messageId,
        timestamp,
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errorData = error.response?.data;
      lastErrorMsg =
        errorData?.message ||
        (typeof errorData === 'string' ? errorData : null) ||
        error.message ||
        'Unknown Discord error';

      const isFatal = status === 400 || status === 401 || status === 404 || (status === 429 && attempt >= maxAttempts);

      if (status === 429 && attempt < maxAttempts) {
        // Parse retry_after in seconds from body or headers (spec: Math.ceil(retry_after * 1000) + 100ms)
        const retryAfterSeconds =
          errorData?.retry_after ??
          (error.response?.headers?.['retry-after']
            ? parseFloat(error.response.headers['retry-after'])
            : undefined) ??
          0.5;

        // Convert to ms, add 100ms safety buffer
        const delayMs = Math.max(10, Math.ceil(retryAfterSeconds * 1000) + 100);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      return {
        success: false,
        isFatal,
        error: `Discord webhook delivery failed: ${lastErrorMsg}`,
      };
    }
  }
}
