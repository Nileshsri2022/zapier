import axios from 'axios';
import { replaceKeys } from './utils/replaceKeys';

// Discord incoming webhook URL pattern
const DISCORD_WEBHOOK_REGEX = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/;

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
  embeds?: DiscordEmbed[];
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
 * Convert a hex color string (e.g. "#5865F2") or numeric color to decimal integer.
 */
export function normalizeDiscordColor(color?: string | number): number | undefined {
  if (color === undefined || color === null) return undefined;
  if (typeof color === 'number') {
    return Number.isFinite(color) ? Math.max(0, Math.min(16777215, color)) : undefined;
  }
  const cleanHex = color.replace(/^#/, '').trim();
  const parsed = parseInt(cleanHex, 16);
  return isNaN(parsed) ? undefined : Math.max(0, Math.min(16777215, parsed));
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

  const resolveEmbed = (embed: DiscordEmbed): DiscordEmbed => ({
    ...embed,
    title: embed.title ? replaceKeys(embed.title, metadata) : undefined,
    description: embed.description ? replaceKeys(embed.description, metadata) : undefined,
    url: embed.url ? replaceKeys(embed.url, metadata) : undefined,
    fields: embed.fields?.map((field) => ({
      name: replaceKeys(field.name, metadata),
      value: replaceKeys(field.value, metadata),
      inline: field.inline,
    })),
  });

  if (options.embed) {
    resolved.embed = resolveEmbed(options.embed);
  }
  if (Array.isArray(options.embeds)) {
    resolved.embeds = options.embeds.map(resolveEmbed);
  }

  return resolved;
}

/**
 * Mask the webhook secret token from a Discord incoming webhook URL to prevent credential leakage.
 */
export function maskDiscordWebhookUrl(url: string): string {
  if (!url || typeof url !== 'string') return '';
  return url.replace(/\/webhooks\/(\d+)\/([A-Za-z0-9_-]+)/, '/webhooks/$1/****');
}

/**
 * Send a message or rich embed via Discord Incoming Webhook.
 */
export async function sendDiscordMessage(
  webhookUrl: string,
  options: DiscordMessageOptions
): Promise<DiscordMessageResult> {
  if (!isValidDiscordWebhookUrl(webhookUrl)) {
    return {
      success: false,
      isFatal: true,
      error: 'Invalid Discord webhook URL. Must match https://discord.com/api/webhooks/{id}/{token}',
    };
  }

  const { content, username, avatarUrl, embed, embeds } = options;

  const resolvedEmbeds: any[] = [];
  if (Array.isArray(embeds)) {
    for (const e of embeds) {
      resolvedEmbeds.push({
        ...e,
        color: normalizeDiscordColor(e.color),
      });
    }
  } else if (embed && typeof embed === 'object') {
    resolvedEmbeds.push({
      ...embed,
      color: normalizeDiscordColor(embed.color),
    });
  }

  const hasContent = typeof content === 'string' && content.trim().length > 0;
  const hasEmbeds = resolvedEmbeds.length > 0;

  if (!hasContent && !hasEmbeds) {
    return {
      success: false,
      isFatal: true,
      error: 'Either content or embed is required to send a Discord message.',
    };
  }

  const payload: Record<string, any> = {};

  if (hasContent) {
    // Discord max message content is 2,000 characters
    payload.content = content!.slice(0, 2000);
  }

  if (hasEmbeds) {
    payload.embeds = resolvedEmbeds.map((em) => ({
      ...em,
      title: em.title ? String(em.title).slice(0, 256) : undefined,
      description: em.description ? String(em.description).slice(0, 4096) : undefined,
    }));
  }

  if (username && typeof username === 'string') {
    payload.username = username.slice(0, 80);
  }

  if (avatarUrl && typeof avatarUrl === 'string') {
    payload.avatar_url = avatarUrl;
  }

  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  const targetUrl = url.toString();

  const maxAttempts = 3;
  let lastErrorMsg = 'Unknown Discord error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

      const isFatal = status === 400 || status === 404 || (status === 429 && attempt >= maxAttempts);

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

  return {
    success: false,
    isFatal: true,
    error: `Discord webhook delivery failed: ${lastErrorMsg}`,
  };
}
