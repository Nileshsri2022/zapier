import { resolvePlaceholders } from '@repo/placeholders';

/**
 * A2 — Email action (docs/ask-matt/actions/email.md, grilled round 12):
 * Q-EMAIL-01 Gmail API via the shared Google connection (GmailServer row from
 * trigger T1) · Q-EMAIL-02 full field set · Q-EMAIL-03 multipart alternative
 * (plain required, HTML optional) · Q-EMAIL-04 URL attachments ≤ 5 MB with
 * fail-closed fetch · Q-EMAIL-05 from-address constrained to owned identities.
 *
 * Error classes: `validation` · `attachment_fetch_failed` · `from_not_allowed`
 * · `quota` · `auth` · `provider` — non-transient classes never retry.
 * Send is at-least-once (Gmail has no idempotency key; bounded transient retry
 * can duplicate after an accepted-but-timed-out request — documented in spec §5).
 * OAuth tokens are never logged or placed in error messages.
 */

export type EmailErrorCode =
  | 'validation'
  | 'attachment_fetch_failed'
  | 'from_not_allowed'
  | 'quota'
  | 'auth'
  | 'provider';

export class EmailActionError extends Error {
  constructor(
    message: string,
    public readonly code: EmailErrorCode,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'EmailActionError';
  }
}

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024; // Q-EMAIL-04: 5 MB per attachment
export const ATTACHMENT_TIMEOUT_MS = 15_000;

export interface EmailAttachment {
  url: string;
  filename: string;
  mimeType: string;
  data: string; // base64
}

export interface ParsedEmailInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyPlain: string;
  bodyHtml: string;
  replyTo: string;
  fromName: string;
  fromEmail: string;
  attachments: { url: string; filename: string }[];
}

export interface SendEmailOutput {
  sent: true;
  messageId: string;
  accepted: string[];
  rejected: string[];
  provider: 'gmail-api';
  sentAt: string;
  // Legacy template aliases (pre-A2 consumers referenced to/subject/sentAt).
  to: string;
  subject: string;
}

/** Minimal structural slice of the Prisma client used by this action. */
export interface EmailDb {
  gmailServer: {
    findFirst: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
}

export interface SendEmailDeps {
  fetchImpl?: typeof fetch;
  db?: EmailDb;
  now?: () => number;
}

const EMAIL_RE = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;
const isAddress = (value: string) => EMAIL_RE.test(value);

function template(value: string, run: Record<string, unknown>): string {
  // Both `{{a.b}}` and `{a.b}` are handled by @repo/placeholders (Q2).
  return String(resolvePlaceholders(value, run));
}

function parseList(value: unknown, field: string): string[] {
  if (value === undefined || value === null || value === '') return [];
  const parts = Array.isArray(value)
    ? value.map((entry) => String(entry ?? ''))
    : String(value)
        .split(/[\n,;]+/)
        .map((entry) => entry.trim());
  const items = parts.map((entry) => entry.trim()).filter(Boolean);
  if (!Array.isArray(value) && items.length === 0 && String(value).trim())
    throw new EmailActionError(`Invalid ${field} address list: ${String(value)}`, 'validation');
  return items;
}

function requireList(items: string[], field: string): string[] {
  if (!items.length)
    throw new EmailActionError(`At least one ${field} recipient is required`, 'validation');
  for (const item of items)
    if (!isAddress(item)) throw new EmailActionError(`Invalid ${field} address: ${item}`, 'validation');
  return items;
}

function rejectHeaderBreaks(value: string, field: string): string {
  if (/[\r\n]/.test(value))
    throw new EmailActionError(`${field} must not contain line breaks`, 'validation');
  return value;
}

/** Q-EMAIL-02 + validation (spec §4): template, split, and check every field pre-send. */
export function parseEmailInput(raw: unknown, run: Record<string, unknown>): ParsedEmailInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new EmailActionError('Email action metadata must be an object', 'validation');
  const meta = raw as Record<string, unknown>;
  const str = (value: unknown): string =>
    value === undefined || value === null ? '' : template(String(value), run).trim();

  const to = requireList(parseList(meta.to, 'to').map((v) => template(v, run).trim()), 'to');
  const cc = parseList(meta.cc, 'cc').map((v) => template(v, run).trim()).filter(Boolean);
  const bcc = parseList(meta.bcc, 'bcc').map((v) => template(v, run).trim()).filter(Boolean);
  for (const list of [cc, bcc])
    for (const item of list)
      if (!isAddress(item)) throw new EmailActionError(`Invalid recipient address: ${item}`, 'validation');

  // bodyPlain required (legacy `body` accepted as its pre-A2 alias).
  const bodyPlain = str(meta.bodyPlain) || str(meta.body);
  if (!bodyPlain) throw new EmailActionError('bodyPlain is required', 'validation');
  const subject = str(meta.subject);
  if (!subject) throw new EmailActionError('subject is required', 'validation');
  rejectHeaderBreaks(subject, 'subject');

  const fromName = str(meta.fromName);
  rejectHeaderBreaks(fromName, 'fromName');
  const fromEmail = str(meta.fromEmail);
  if (fromEmail && !isAddress(fromEmail))
    throw new EmailActionError(`Invalid fromEmail address: ${fromEmail}`, 'validation');

  const replyTo = str(meta.replyTo);
  if (replyTo && !isAddress(replyTo))
    throw new EmailActionError(`Invalid replyTo address: ${replyTo}`, 'validation');

  const rawAttachments = Array.isArray(meta.attachments) ? meta.attachments : [];
  const attachments = rawAttachments.map((entry, index) => {
    const url = typeof entry === 'string' ? template(entry, run).trim() : template(String((entry as any)?.url ?? ''), run).trim();
    const filename =
      typeof entry === 'string'
        ? ''
        : template(String((entry as any)?.filename ?? ''), run).trim();
    if (!url) throw new EmailActionError(`Attachment ${index + 1} is missing a URL`, 'validation');
    if (!/^https?:\/\//i.test(url))
      throw new EmailActionError(`Attachment ${index + 1} has an invalid URL: ${url}`, 'validation');
    return { url, filename };
  });

  return { to, cc, bcc, subject, bodyPlain, bodyHtml: str(meta.bodyHtml), replyTo, fromName, fromEmail, attachments };
}

const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  zip: 'application/zip',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function filenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
    return last || 'attachment';
  } catch {
    return 'attachment';
  }
}

/**
 * Q-EMAIL-04 — fetch a URL attachment with a hard 5 MB cap.
 * Unreachable or oversize ⇒ `attachment_fetch_failed` (never silently omitted).
 */
export async function fetchAttachment(
  url: string,
  filenameHint: string,
  fetchImpl: typeof fetch
): Promise<EmailAttachment> {
  const fail = (reason: string): never => {
    throw new EmailActionError(`attachment_fetch_failed: ${url} (${reason})`, 'attachment_fetch_failed');
  };
  let response: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);
    try {
      response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const reason = (error as Error)?.name === 'AbortError' ? 'timed out' : 'unreachable';
    return fail(reason);
  }
  if (!response.ok) return fail(`HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || '0');
  if (Number.isFinite(declared) && declared > ATTACHMENT_MAX_BYTES)
    return fail(`oversize (${declared} bytes > 5 MB)`);

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return fail('empty response body');
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > ATTACHMENT_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      return fail(`oversize (>${ATTACHMENT_MAX_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  if (!bytes) return fail('empty file');

  const filename = filenameHint || filenameFromUrl(url);
  const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  return {
    url,
    filename,
    mimeType: EXT_TYPES[extension] || 'application/octet-stream',
    data: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('base64'),
  };
}

const headerWord = (value: string): string =>
  // RFC 2047 encode-word for non-ASCII; ASCII subjects pass through (CRLF rejected earlier).
  /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;

function wrapBase64(data: string): string {
  return (data.match(/.{1,76}/g) || []).join('\r\n');
}

/** Q-EMAIL-03: multipart alternative (plain + HTML) with attachments as multipart/mixed. */
export function buildMime(
  input: ParsedEmailInput,
  fromAddress: string,
  attachments: EmailAttachment[]
): string {
  const { to, cc, bcc, subject, bodyPlain, bodyHtml, replyTo, fromName } = input;
  const from = fromName ? `"${fromName}" <${fromAddress}>` : `<${fromAddress}>`;
  const headers = [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(', ')}`] : []),
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${headerWord(subject)}`,
    'MIME-Version: 1.0',
  ];

  const mixBoundary = `zm-mixed-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
  const altBoundary = `zm-alt-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

  if (!attachments.length) {
    if (!bodyHtml)
      return [
        ...headers,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        bodyPlain,
      ].join('\r\n');
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      bodyPlain,
      `--${altBoundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '',
      bodyHtml,
      `--${altBoundary}--`,
    ].join('\r\n');
  }

  const alternative = bodyHtml
    ? [
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        bodyPlain,
        `--${altBoundary}`,
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        bodyHtml,
        `--${altBoundary}--`,
      ]
    : [
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        bodyPlain,
      ];

  const attachmentParts = attachments.flatMap((attachment) => [
    `--${mixBoundary}`,
    `Content-Type: ${attachment.mimeType}; name="${attachment.filename}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    '',
    wrapBase64(attachment.data),
  ]);

  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
    '',
    ...alternative,
    ...attachmentParts,
    `--${mixBoundary}--`,
  ].join('\r\n');
}

export const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface GmailServerRow {
  id: string;
  email: string | null;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  tokenExpiry: Date | null;
}

interface ResolvedGmail {
  server: GmailServerRow;
  token: string;
}

/** Resolve the shared Google (Gmail) connection — Q-X-03/Q-EMAIL-01. */
async function resolveGmailServer(
  userId: number,
  serverId: string | undefined,
  db: EmailDb
): Promise<GmailServerRow> {
  const server = await db.gmailServer.findFirst({
    where: { userId, isActive: true, ...(serverId ? { id: serverId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
  if (!server)
    throw new EmailActionError(
      'No active Gmail connection for this account — reconnect Gmail to send email',
      'auth'
    );
  return server;
}

/** Refresh the OAuth access token when expired (tokens never logged). */
async function ensureToken(
  server: GmailServerRow,
  db: EmailDb,
  fetchImpl: typeof fetch,
  now: () => number
): Promise<string> {
  if (server.accessToken && server.tokenExpiry && server.tokenExpiry.getTime() > now() + 60_000)
    return server.accessToken;
  let payload: Record<string, unknown>;
  try {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: server.clientId,
        client_secret: server.clientSecret,
        refresh_token: server.refreshToken ?? '',
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!response.ok) {
      const transient = response.status >= 500;
      throw new EmailActionError(
        transient
          ? 'Gmail token refresh failed temporarily (HTTP ' + response.status + ')'
          : 'Gmail connection is revoked or invalid — reconnect Gmail',
        transient ? 'provider' : 'auth',
        transient
      );
    }
    payload = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof EmailActionError) throw error;
    throw new EmailActionError('Gmail token refresh failed: network error', 'provider', true);
  }
  const token = String(payload.access_token || '');
  if (!token) throw new EmailActionError('Gmail token refresh returned no access token', 'auth');
  const expiresIn = Number(payload.expires_in ?? 3600);
  // Best-effort persistence (mirrors GmailService.ensureValidToken).
  try {
    await db.gmailServer.update({
      where: { id: server.id },
      data: { accessToken: token, tokenExpiry: new Date(now() + expiresIn * 1000) },
    });
  } catch {
    /* token still usable for this send */
  }
  return token;
}

/** Q-EMAIL-05: from must be the mailbox or a verified send-as identity. */
async function assertOwnedFrom(
  fromEmail: string,
  server: GmailServerRow,
  token: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const mailbox = (server.email || '').toLowerCase();
  if (fromEmail.toLowerCase() === mailbox) return;
  try {
    const response = await fetchImpl(
      'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (response.ok) {
      const body = (await response.json()) as { sendAs?: { sendAsEmail?: string; verified?: boolean }[] };
      const owned = (body.sendAs || [])
        .filter((entry) => entry.verified !== false)
        .map((entry) => (entry.sendAsEmail || '').toLowerCase());
      if (owned.includes(fromEmail.toLowerCase())) return;
      throw new EmailActionError(
        `from_not_allowed: ${fromEmail} is not a mailbox or verified alias of the connected Gmail account`,
        'from_not_allowed'
      );
    }
    // sendAs lookup failed open — provider rejection on send still classifies.
  } catch (error) {
    if (error instanceof EmailActionError) throw error;
    // Network/lookup failure: fall through to send; provider rejection classifies.
  }
}

function classifyGmailSendError(status: number, bodyText: string): EmailActionError {
  const lower = bodyText.toLowerCase();
  if (status === 401 || /invalid credentials|invalid_grant|unauthenticated/.test(lower))
    return new EmailActionError(
      'Gmail connection is revoked or invalid — reconnect Gmail',
      'auth'
    );
  if (status === 429 || /quota|rate limit|too many requests|user rate limit/.test(lower))
    return new EmailActionError(
      `Gmail send quota exhausted or rate limited (HTTP ${status}) — try again later or reduce volume`,
      'quota'
    );
  if (/from address|sendas|sender address|from is not allowed|alias|mailbox owner/.test(lower))
    return new EmailActionError(
      'from_not_allowed: Gmail rejected the configured from-address',
      'from_not_allowed'
    );
  return new EmailActionError(
    `Gmail send failed (HTTP ${status})`,
    'provider',
    status >= 500 || status === 408
  );
}

export async function sendEmailAction(
  rawMetadata: unknown,
  runMetadata: Record<string, unknown>,
  deps: SendEmailDeps = {}
): Promise<SendEmailOutput> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  // Lazy import keeps this module loadable without a generated Prisma client
  // (tests inject `db`); production resolves the shared Prisma singleton.
  const db: EmailDb = deps.db ?? ((await import('@repo/db')).default as unknown as EmailDb);
  const now = deps.now ?? Date.now;

  const input = parseEmailInput(rawMetadata, runMetadata);

  // Q-EMAIL-04: fetch all attachments BEFORE sending — any failure fails the run.
  const attachments = await Promise.all(
    input.attachments.map((entry) => fetchAttachment(entry.url, entry.filename, fetchImpl))
  );

  const server = await resolveGmailServer(
    Number((runMetadata as any)?.userId ?? (runMetadata as any)?.zap?.userId ?? 0) || 0,
    typeof (rawMetadata as any)?.serverId === 'string' ? (rawMetadata as any).serverId : undefined,
    db
  );
  const token = await ensureToken(server, db, fetchImpl, now);

  const fromAddress =
    input.fromEmail ||
    server.email ||
    (() => {
      throw new EmailActionError('Connected Gmail account has no mailbox address', 'auth');
    })();
  if (input.fromEmail) await assertOwnedFrom(input.fromEmail, server, token, fetchImpl);

  const mime = buildMime(input, fromAddress, attachments);
  const raw = toBase64Url(mime);

  let response: Response;
  try {
    response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ raw }),
    });
  } catch (error) {
    const timedOut = (error as Error)?.name === 'AbortError';
    throw new EmailActionError(
      timedOut ? 'Gmail send timed out (at-least-once: a retry may duplicate)' : 'Gmail send failed: network error',
      'provider',
      true
    );
  }
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw classifyGmailSendError(response.status, bodyText);
  }
  const body = (await response.json().catch(() => ({}))) as { id?: string };
  const messageId = body.id || '';

  return {
    sent: true,
    messageId,
    accepted: [...input.to, ...input.cc, ...input.bcc],
    rejected: [],
    provider: 'gmail-api',
    sentAt: new Date(now()).toISOString(),
    // Legacy aliases for existing templates.
    to: input.to.join(', '),
    subject: input.subject,
  };
}
