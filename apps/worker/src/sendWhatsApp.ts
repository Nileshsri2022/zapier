/**
 * A5 — WhatsApp Send action (docs/ask-matt/actions/whatsapp.md, grilled
 * round 15).
 *
 * Q-WA-A-01 templates + freeform with the 24h session window enforced ·
 * Q-WA-A-02 approved-template dropdown with positional {{1}}..{{n}} params ·
 * Q-WA-A-03 media by link + caption · Q-WA-A-04 strict country-coded phone
 * validation · Q-WA-A-05 API-accepted = success · Q-WA-A-06 per-step sender
 * picker limited to the connection's number ids.
 *
 * Credentials come from the shared WhatsAppServer connection (never from the
 * Zap step) and are never logged or echoed in errors.
 */

import { resolvePlaceholders } from '@repo/placeholders';

const GRAPH_URL = 'https://graph.facebook.com/v18.0';
const REQUEST_TIMEOUT_MS = 10_000;
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppErrorCode =
  | 'validation'
  | 'invalid_recipient'
  | 'template_not_found'
  | 'template_not_approved'
  | 'param_count_mismatch'
  | 'outside_session_window'
  | 'media_fetch_failed'
  | 'auth'
  | 'rate_limited'
  | 'provider';

export class WhatsAppActionError extends Error {
  constructor(
    message: string,
    public readonly code: WhatsAppErrorCode,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'WhatsAppActionError';
  }
}

export interface WhatsAppServerRow {
  id: string;
  phoneNumberId: string;
  accessToken: string;
  businessId: string;
  displayName?: string | null;
  phoneNumber?: string | null;
}

export interface WhatsAppDb {
  whatsAppServer: {
    findFirst: (args: any) => Promise<any>;
    findMany?: (args: any) => Promise<any[]>;
  };
}

export interface WhatsAppOutput {
  sent: true;
  messageId: string;
  to: string;
  fromPhoneNumberId: string;
  kind: 'template' | 'freeform';
  acceptedAt: string;
  error: null;
}

export interface WhatsAppDeps {
  fetchImpl?: typeof fetch;
  db?: WhatsAppDb;
  now?: () => number;
}

export interface ParsedRecipient {
  /** Digits only, country code included — the value Meta expects. */
  to: string;
  wasValid: boolean;
}

/**
 * Q-WA-A-04: strict country-coded phone. A `+` is optional, then digits only
 * (spaces/dashes/parens are stripped); nothing may start with 0 and the national
 * significant number must land in E.164's 7–15 digit window.
 */
export function normalizeRecipient(raw: unknown): ParsedRecipient {
  const value = String(raw ?? '').trim();
  if (!value)
    throw new WhatsAppActionError('Recipient phone number is required', 'invalid_recipient');
  const withoutFormatting = value.replace(/[\s\-().]/g, '');
  const hasPlus = withoutFormatting.startsWith('+');
  const body = hasPlus ? withoutFormatting.slice(1) : withoutFormatting;
  if (!/^\d{7,15}$/.test(body))
    throw new WhatsAppActionError(
      `invalid_recipient: "${value}" must be a country-coded phone number (digits only, 7–15 digits)`,
      'invalid_recipient'
    );
  if (body.startsWith('0'))
    throw new WhatsAppActionError(
      `invalid_recipient: "${value}" starts with 0 — include the country code (e.g. 91… for India)`,
      'invalid_recipient'
    );
  // Q-WA-A-04: country code is mandatory. Without a leading '+', an E.164 number
  // is at least 11 digits (country code + national number); a bare 10-digit
  // national number is rejected pre-send rather than sent to the wrong country.
  if (!hasPlus && body.length < 11)
    throw new WhatsAppActionError(
      `invalid_recipient: "${value}" is missing a country code — prefix the international code ` +
        '(e.g. +91 98765 43210) or write it with a leading +',
      'invalid_recipient'
    );
  return { to: body, wasValid: true };
}

function parseMetadata(raw: unknown): Record<string, any> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new WhatsAppActionError('WhatsApp action metadata must be an object', 'validation');
  return raw as Record<string, any>;
}

function template(value: unknown, run: Record<string, unknown>): string {
  if (value === undefined || value === null) return '';
  // Meta's approved-template slots ({{1}}..{{n}}) are not run metadata.
  return String(resolvePlaceholders(value, run, { positional: true }));
}

/** Q-WA-A-06: resolve the sender from the shared connection (never from step secrets). */
export async function resolveSender(
  metadata: Record<string, any>,
  userId: number,
  db: WhatsAppDb
): Promise<WhatsAppServerRow> {
  const requested = String(metadata.fromPhoneNumberId ?? metadata.phoneNumberId ?? '').trim();
  const server = await db.whatsAppServer.findFirst({
    where: {
      ...(userId ? { userId } : {}),
      isActive: true,
      ...(requested ? { phoneNumberId: requested } : {}),
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!server)
    throw new WhatsAppActionError(
      requested
        ? `Sender ${requested} is not one of this account's connected WhatsApp numbers — pick a sender from the connection`
        : 'No active WhatsApp connection for this account — connect a WhatsApp number first',
      'auth'
    );
  if (requested && server.phoneNumberId !== requested)
    throw new WhatsAppActionError(
      `Sender ${requested} is not on this connection — pick one of its number ids`,
      'auth'
    );
  return server as WhatsAppServerRow;
}

/** Q-WA-A-03: media links are verified before sending (no silent text-only fallback). */
export async function assertMediaReachable(
  mediaUrl: string,
  fetchImpl: typeof fetch
): Promise<string> {
  let url: URL;
  try {
    url = new URL(mediaUrl);
  } catch {
    throw new WhatsAppActionError(`media_fetch_failed: invalid media URL "${mediaUrl}"`, 'media_fetch_failed');
  }
  if (!['http:', 'https:'].includes(url.protocol))
    throw new WhatsAppActionError(
      `media_fetch_failed: media URL must be http(s), got "${url.protocol}"`,
      'media_fetch_failed'
    );

  const attempt = async (method: 'HEAD' | 'GET') => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchImpl(mediaUrl, { method, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response | undefined;
  try {
    response = await attempt('HEAD');
    if (response.status === 405 || response.status === 501) response = await attempt('GET');
  } catch {
    response = undefined;
  }
  if (!response || !response.ok)
    throw new WhatsAppActionError(
      `media_fetch_failed: ${mediaUrl} is unreachable${response ? ` (HTTP ${response.status})` : ''}`,
      'media_fetch_failed'
    );
  return mediaUrl;
}

function buildTemplatePayload(
  metadata: Record<string, any>,
  to: string,
  run: Record<string, unknown>
) {
  const templateConfig = metadata.template ?? {};
  const name = String(templateConfig.name ?? metadata.templateName ?? '').trim();
  if (!name)
    throw new WhatsAppActionError('A template must be selected for template messages', 'validation');
  const language = String(templateConfig.language ?? metadata.templateLanguage ?? 'en_US').trim();
  const rawParams = Array.isArray(templateConfig.params)
    ? templateConfig.params
    : metadata.templateParams
      ? String(metadata.templateParams)
          .split('\n')
          .filter((entry) => entry.trim() !== '')
      : [];
  const params = rawParams.map((param: unknown) => template(param, run).trim());
  const declaredCount = Number(
    templateConfig.paramCount ?? metadata.templateParamCount ?? NaN
  );
  if (Number.isFinite(declaredCount) && declaredCount !== params.length)
    throw new WhatsAppActionError(
      `param_count_mismatch: template "${name}" expects ${declaredCount} parameter(s), got ${params.length}`,
      'param_count_mismatch'
    );
  if (params.some((param: string) => !param))
    throw new WhatsAppActionError(
      'Template parameters must not be empty',
      'validation'
    );
  if (params.length > 10)
    throw new WhatsAppActionError(
      'A template body supports at most 10 positional parameters',
      'validation'
    );

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name,
      language: { code: language },
      ...(params.length
        ? { components: [{ type: 'body', parameters: params.map((text: string) => ({ type: 'text', text })) }] }
        : {}),
    },
  };
}

function buildFreeformPayload(
  metadata: Record<string, any>,
  to: string,
  run: Record<string, unknown>,
  mediaUrl?: string
) {
  const freeform = metadata.freeform ?? {
    text: metadata.message ?? metadata.text,
    mediaUrl: metadata.mediaUrl,
    caption: metadata.caption,
    previewUrl: metadata.previewUrl,
  };
  const text = template(freeform.text, run).trim();
  const caption = template(freeform.caption ?? '', run).trim();
  if (!text && !caption && !mediaUrl)
    throw new WhatsAppActionError('Freeform messages need text, a caption or media', 'validation');
  if (text.length > 4096)
    throw new WhatsAppActionError(
      `Freeform text is ${text.length} characters — WhatsApp allows 4096`,
      'validation'
    );

  if (mediaUrl) {
    const mediaType = String(metadata.mediaType ?? 'image').toLowerCase();
    if (!['image', 'document', 'video', 'audio'].includes(mediaType))
      throw new WhatsAppActionError(
        `Unsupported media type "${mediaType}" — use image, document, video or audio`,
        'validation'
      );
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: mediaType,
      [mediaType]: {
        link: mediaUrl,
        ...(caption && mediaType !== 'audio' ? { caption } : {}),
      },
    };
  }

  if (text.length > 1024 && caption)
    throw new WhatsAppActionError('Too much text', 'validation');

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: {
      preview_url: Boolean(freeform.previewUrl),
      body: text,
    },
  };
}

const GRAPH_ERROR_CODES: Record<number, WhatsAppErrorCode> = {
  131047: 'outside_session_window',
  131026: 'provider',
  132000: 'param_count_mismatch',
  132001: 'template_not_found',
  132005: 'template_not_approved',
  190: 'auth',
  100: 'validation',
};

function classifyGraphError(status: number, error: any): WhatsAppActionError {
  const code = Number(error?.code ?? error?.error_subcode ?? NaN);
  const message = String(error?.message ?? '');
  const mapped: WhatsAppErrorCode | undefined = GRAPH_ERROR_CODES[code];
  const lower = message.toLowerCase();

  if (status === 401 || mapped === 'auth' || /access token|session has expired/.test(lower))
    return new WhatsAppActionError(
      'WhatsApp connection is invalid or expired — reconnect the number (token redacted)',
      'auth'
    );
  if (status === 429 || code === 131056 || /rate limit|too many/.test(lower))
    return new WhatsAppActionError(
      'WhatsApp rate limit hit — the send will be retried with backoff',
      'rate_limited',
      true
    );
  if (mapped === 'outside_session_window' || /re-?engagement|24\s*hour|outside.*window/.test(lower))
    return new WhatsAppActionError(
      'outside_session_window: the customer has not messaged in the last 24 hours — send an approved template instead',
      'outside_session_window'
    );
  if (mapped === 'template_not_found' || /template.*(not found|does not exist)/.test(lower))
    return new WhatsAppActionError(
      'template_not_found: the selected template no longer exists on this WABA — refresh the list',
      'template_not_found'
    );
  if (mapped === 'template_not_approved' || /template.*(not approved|pending|rejected)/.test(lower))
    return new WhatsAppActionError(
      'template_not_approved: the selected template is not approved yet',
      'template_not_approved'
    );
  if (mapped === 'param_count_mismatch' || /number of parameters|param/.test(lower))
    return new WhatsAppActionError(
      `param_count_mismatch: ${message || 'template parameters do not match'}`,
      'param_count_mismatch'
    );
  if (mapped === 'validation')
    return new WhatsAppActionError(`WhatsApp rejected the message: ${message}`, 'validation');

  return new WhatsAppActionError(
    `WhatsApp send failed (HTTP ${status})${message ? `: ${message}` : ''}`,
    'provider',
    status >= 500
  );
}

/**
 * Send one WhatsApp message. API acceptance (a message id) is success —
 * delivery statuses are deliberately not awaited (Q-WA-A-05).
 */
export async function sendWhatsAppAction(
  rawMetadata: unknown,
  runMetadata: Record<string, unknown> = {},
  deps: WhatsAppDeps = {}
): Promise<WhatsAppOutput> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const db: WhatsAppDb = deps.db ?? ((await import('@repo/db')).default as unknown as WhatsAppDb);
  const now = deps.now ?? Date.now;

  const metadata = parseMetadata(rawMetadata);
  const userId = Number((runMetadata as any)?.userId ?? (runMetadata as any)?.zap?.userId ?? 0) || 0;
  const server = await resolveSender(metadata, userId, db);

  const recipient = normalizeRecipient(template(metadata.to, runMetadata));
  const kind = String(metadata.kind ?? (metadata.template ? 'template' : 'freeform')).toLowerCase();
  if (!['template', 'freeform'].includes(kind))
    throw new WhatsAppActionError(
      `Unsupported message kind "${kind}" — use template or freeform`,
      'validation'
    );

  // 24h session window (Q-WA-A-01): pre-check when the run carries the last
  // inbound message time; Meta's own rejection is classified the same way.
  if (kind === 'freeform') {
    const lastInbound = (runMetadata as any)?.lastCustomerMessageAt;
    if (lastInbound) {
      const last = new Date(String(lastInbound)).getTime();
      if (Number.isFinite(last) && now() - last > SESSION_WINDOW_MS)
        throw new WhatsAppActionError(
          'outside_session_window: the customer has not messaged in the last 24 hours — send an approved template instead',
          'outside_session_window'
        );
    }
  }

  let mediaUrl: string | undefined;
  if (kind === 'freeform') {
    const rawMedia = (metadata.freeform ?? metadata).mediaUrl;
    if (rawMedia)
      mediaUrl = await assertMediaReachable(template(rawMedia, runMetadata).trim(), fetchImpl);
  }

  const payload =
    kind === 'template'
      ? buildTemplatePayload(metadata, recipient.to, runMetadata)
      : buildFreeformPayload(metadata, recipient.to, runMetadata, mediaUrl);

  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetchImpl(`${GRAPH_URL}/${server.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${server.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const timedOut = (error as Error)?.name === 'AbortError';
    throw new WhatsAppActionError(
      timedOut ? 'WhatsApp request timed out' : 'WhatsApp send failed: network error',
      'provider',
      true
    );
  }

  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) throw classifyGraphError(response.status, body?.error);

  const messageId = body?.messages?.[0]?.id;
  if (!messageId)
    throw new WhatsAppActionError(
      'WhatsApp accepted the request but returned no message id',
      'provider',
      true
    );

  return {
    sent: true,
    messageId,
    to: recipient.to,
    fromPhoneNumberId: server.phoneNumberId,
    kind: kind as 'template' | 'freeform',
    acceptedAt: new Date(now()).toISOString(),
    error: null,
  };
}
