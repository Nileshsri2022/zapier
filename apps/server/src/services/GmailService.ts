import { google, gmail_v1 } from 'googleapis';
// OAuth2Client type imported from googleapis to avoid version conflicts
import client from '@repo/db';
import { GmailRateLimiter } from './GmailRateLimiter';
import { GmailErrorHandler, GmailErrorType } from './GmailErrorHandler';

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  tokenExpiry?: Date;
  /**
   * The `GmailServer` row these credentials belong to. Refreshed tokens are
   * written back to this row only — see `ensureValidToken` (#38).
   */
  serverId?: string;
}

export interface EmailFilter {
  sender?: string;
  subject?: string;
  labels?: string[];
  hasAttachment?: boolean;
  isRead?: boolean;
}

export interface EmailMetadata {
  id: string;
  threadId: string;
  snippet: string;
  from: string;
  to: string[];
  subject: string;
  date: Date;
  labels: string[];
  hasAttachments: boolean;
  isRead: boolean;
}

/** 5 MB — grilled auto-fetch cap for trigger attachments (Q-GMAIL-04). */
export const GMAIL_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Attachment contract for Gmail trigger run payloads (spec §4).
 * `content` is the raw base64url blob from Gmail's attachments.get
 * (`contentEncoding: 'base64url'`) and is present only when the attachment
 * was ≤ GMAIL_ATTACHMENT_MAX_BYTES and fetchable. Anything larger or
 * unfetchable is metadata-only with `contentTruncated: true`.
 */
export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  content?: string;
  contentEncoding?: 'base64url';
  contentTruncated?: boolean;
}

export class GmailService {
  private oauth2Client: any;
  private gmail: gmail_v1.Gmail;
  private rateLimiter: GmailRateLimiter;
  private errorHandler: GmailErrorHandler;
  private serverId?: string;

  constructor(config: GmailConfig) {
    this.serverId = config.serverId;
    // @ts-ignore - OAuth2Client version conflict between googleapis and google-auth-library
    this.oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);

    // Set credentials
    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
      access_token: config.accessToken,
      expiry_date: config.tokenExpiry?.getTime(),
    });

    // @ts-ignore - OAuth2Client version conflict
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client as any });

    // Initialize rate limiter and error handler
    this.rateLimiter = new GmailRateLimiter();
    this.errorHandler = new GmailErrorHandler();
  }

  /**
   * Refresh access token if expired
   */
  private async ensureValidToken(): Promise<void> {
    const now = new Date();
    const expiryTime = this.oauth2Client.credentials.expiry_date;

    if (!expiryTime || now.getTime() >= expiryTime - 60000) {
      // Refresh 1 minute before expiry
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);

      // Update database with the new token — scoped to *this* mailbox.
      //
      // `clientId` is the OAuth app's client id and is identical for every
      // user, so scoping the write by it rewrote every tenant's access token
      // with this user's refreshed one (#38): the next request by any other
      // mailbox then authenticated as the wrong account. Without a server id
      // there is no safe scope, so the in-memory token is used and the row is
      // left alone until the caller supplies one.
      if (credentials.access_token && credentials.expiry_date) {
        if (this.serverId) {
          await client.gmailServer.updateMany({
            where: { id: this.serverId },
            data: {
              accessToken: credentials.access_token,
              tokenExpiry: new Date(credentials.expiry_date),
            },
          });
        } else {
          console.warn(
            'GmailService: token refreshed without a serverId; skipping the database write'
          );
        }
      }
    }
  }

  /**
   * Watch for email changes
   */
  async watchEmails(labelIds: string[] = ['INBOX']): Promise<{ watchId: string; expiry: Date }> {
    return this.errorHandler.executeWithRetry(async () => {
      // Check rate limit before making request
      const rateLimitCheck = this.rateLimiter.canMakeRequest(50); // Watching costs quota
      if (!rateLimitCheck.allowed) {
        await this.delay(rateLimitCheck.waitTime!);
      }

      await this.ensureValidToken();

      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: {
          labelIds,
          topicName:
            process.env.GMAIL_PUBSUB_TOPIC || 'projects/your-project/topics/gmail-notifications',
        },
      });

      // Record the request
      this.rateLimiter.recordRequest(50);

      return {
        watchId: response.data.historyId || '',
        expiry: new Date(response.data.expiration || Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days
      };
    });
  }

  /**
   * Stop watching emails
   */
  async stopWatching(): Promise<void> {
    await this.ensureValidToken();
    await this.gmail.users.stop({
      userId: 'me',
    });
  }

  /**
   * Get new emails since last check
   */
  async getNewEmails(filter?: EmailFilter): Promise<EmailMetadata[]> {
    return this.errorHandler.executeWithRetry(async () => {
      // Check rate limit before making request
      const rateLimitCheck = this.rateLimiter.canMakeRequest(10); // Estimate 10 quota units
      if (!rateLimitCheck.allowed) {
        await this.delay(rateLimitCheck.waitTime!);
      }

      await this.ensureValidToken();

      const query = this.buildQuery(filter);
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 50,
      });

      // Record the request
      this.rateLimiter.recordRequest(10);

      const emails: EmailMetadata[] = [];

      if (response.data.messages) {
        for (const message of response.data.messages) {
          const emailData = await this.getEmailMetadata(message.id!);
          if (emailData) {
            emails.push(emailData);
          }
        }
      }

      return emails;
    });
  }

  /**
   * Get email metadata by ID
   */
  async getEmailMetadata(messageId: string): Promise<EmailMetadata | null> {
    await this.ensureValidToken();

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const headers = response.data.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      return {
        id: response.data.id || '',
        threadId: response.data.threadId || '',
        snippet: response.data.snippet || '',
        from: getHeader('From'),
        to: getHeader('To')
          .split(',')
          .map((email: string) => email.trim()),
        subject: getHeader('Subject'),
        date: new Date(getHeader('Date')),
        labels: response.data.labelIds || [],
        hasAttachments: (response.data.payload?.parts?.length || 0) > 1,
        isRead: !response.data.labelIds?.includes('UNREAD'),
      };
    } catch (error) {
      console.error('Error fetching email metadata:', error);
      return null;
    }
  }

  /**
   * Get the plain-text body of an email by ID.
   *
   * Added for Gmail-trigger hydration (reports/gmail-worker-routing-spec.md
   * D4): trigger payloads need actual email content, not just headers.
   * Returns null on any Gmail API failure, mirroring getEmailMetadata.
   */
  async getEmailContent(messageId: string): Promise<{
    plain: string;
    html: string;
    body: string;
    truncated: boolean;
  } | null> {
    await this.ensureValidToken();

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      return extractEmailParts(response.data.payload);
    } catch (error) {
      console.error('Error fetching email content:', error);
      return null;
    }
  }

  /**
   * Attachment details for a message, with content fetched inline when
   * ≤ GMAIL_ATTACHMENT_MAX_BYTES (grilled answer Q-GMAIL-04: auto-fetch up
   * to 5 MB, metadata-only beyond it). Never throws — hydration failure on
   * one attachment must not take down the whole dispatch (metadata still
   * flows with `contentTruncated: true`).
   */
  async getAttachments(messageId: string): Promise<EmailAttachment[]> {
    await this.ensureValidToken();

    try {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const attachmentParts: any[] = [];
      const walk = (node: any): void => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node.filename && node.body?.attachmentId) attachmentParts.push(node);
        if (Array.isArray(node.parts)) walk(node.parts);
      };
      walk(response.data.payload?.parts);

      const out: EmailAttachment[] = [];
      for (const part of attachmentParts) {
        const meta = {
          filename: String(part.filename),
          mimeType: String(part.mimeType || 'application/octet-stream'),
          size: Number(part.body?.size || 0),
          attachmentId: String(part.body.attachmentId),
        };

        if (meta.size > GMAIL_ATTACHMENT_MAX_BYTES) {
          out.push({ ...meta, contentTruncated: true });
          continue;
        }

        try {
          const att = await this.gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: meta.attachmentId,
          });
          const data = att.data?.data;
          if (typeof data === 'string' && data.length > 0) {
            const approxBytes = Math.floor((data.length * 3) / 4);
            if (approxBytes > GMAIL_ATTACHMENT_MAX_BYTES) {
              out.push({ ...meta, contentTruncated: true });
            } else {
              out.push({ ...meta, content: data, contentEncoding: 'base64url' });
            }
          } else {
            out.push({ ...meta, contentTruncated: true });
          }
        } catch (error) {
          console.error(`Error fetching attachment ${meta.attachmentId}:`, error);
          out.push({ ...meta, contentTruncated: true });
        }
      }
      return out;
    } catch (error) {
      console.error('Error listing attachments:', error);
      return [];
    }
  }

  /**
   * Connected mailbox identity (address + current history id).
   * Used at OAuth time and by the GmailServer.email backfill
   * (reports/gmail-worker-routing-spec.md D3).
   */
  async getProfileEmail(): Promise<{ email: string; historyId: string } | null> {
    await this.ensureValidToken();

    try {
      const response = await this.gmail.users.getProfile({ userId: 'me' });
      return {
        email: response.data.emailAddress || '',
        historyId: response.data.historyId || '',
      };
    } catch (error) {
      console.error('Error fetching Gmail profile:', error);
      return null;
    }
  }

  /**
   * History delta since a stored cursor — how real Gmail watch
   * notifications ({ emailAddress, historyId } only) are turned into
   * concrete message events (spec B2). Returns the raw history records.
   *
   * Returns null when Gmail reports the start history id as too old
   * (HTTP 404) — the caller resets the cursor instead of retrying a
   * delta that can never be listed. Other errors throw so the push
   * provider redelivers and the delta is retried.
   */
  async listHistory(startHistoryId: string): Promise<any[] | null> {
    await this.ensureValidToken();

    try {
      const records: any[] = [];
      let pageToken: string | undefined;

      // Bounded pagination: a single mailbox delta beyond 5 pages is an
      // anomaly (e.g. bulk import); remaining records surface on the
      // next notification because the cursor only advances per batch.
      for (let page = 0; page < 5; page++) {
        const response = await this.gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
          maxResults: 100,
          pageToken,
        });

        records.push(...(response.data.history || []));
        pageToken = response.data.nextPageToken || undefined;
        if (!pageToken) break;
      }

      return records;
    } catch (error: any) {
      const status = error?.code ?? error?.response?.status;
      if (status === 404) {
        console.warn(
          `Gmail history cursor ${startHistoryId} is too old (404) — caller will reset it`
        );
        return null;
      }
      throw error;
    }
  }

  /**
   * Send email
   */
  async sendEmail(
    to: string[],
    subject: string,
    body: string,
    cc?: string[],
    bcc?: string[]
  ): Promise<string> {
    return this.errorHandler.executeWithRetry(async () => {
      // Check rate limit before making request
      const rateLimitCheck = this.rateLimiter.canMakeRequest(100); // Sending emails costs more quota
      if (!rateLimitCheck.allowed) {
        await this.delay(rateLimitCheck.waitTime!);
      }

      await this.ensureValidToken();

      const email = [
        `To: ${to.join(', ')}`,
        cc ? `Cc: ${cc.join(', ')}` : '',
        bcc ? `Bcc: ${bcc.join(', ')}` : '',
        `Subject: ${subject}`,
        '',
        body,
      ]
        .filter((line) => line)
        .join('\r\n');

      const encodedEmail = Buffer.from(email)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const response = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedEmail,
        },
      });

      // Record the request
      this.rateLimiter.recordRequest(100);

      return response.data.id || '';
    });
  }

  /**
   * Reply to email
   */
  async replyToEmail(messageId: string, body: string, replyAll = false): Promise<string> {
    await this.ensureValidToken();

    const originalEmail = await this.getEmailMetadata(messageId);
    if (!originalEmail) {
      throw new Error('Original email not found');
    }

    const to = replyAll ? [...originalEmail.to, originalEmail.from] : [originalEmail.from];
    const subject = originalEmail.subject.startsWith('Re: ')
      ? originalEmail.subject
      : `Re: ${originalEmail.subject}`;

    return await this.sendEmail(to, subject, body);
  }

  /**
   * Add labels to email
   */
  async addLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.ensureValidToken();

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: labelIds,
      },
    });
  }

  /**
   * Remove labels from email
   */
  async removeLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.ensureValidToken();

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: labelIds,
      },
    });
  }

  /**
   * Mark email as read/unread
   */
  async markAsRead(messageId: string, isRead: boolean): Promise<void> {
    await this.ensureValidToken();

    const labelToRemove = isRead ? 'UNREAD' : 'UNREAD';
    const labelToAdd = isRead ? undefined : 'UNREAD';

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: labelToRemove ? [labelToRemove] : undefined,
        addLabelIds: labelToAdd ? [labelToAdd] : undefined,
      },
    });
  }

  /**
   * Archive email
   */
  async archiveEmail(messageId: string): Promise<void> {
    await this.ensureValidToken();

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });
  }

  /**
   * Move email to trash
   */
  async trashEmail(messageId: string): Promise<void> {
    await this.ensureValidToken();

    await this.gmail.users.messages.trash({
      userId: 'me',
      id: messageId,
    });
  }

  /**
   * Create label
   */
  async createLabel(
    name: string,
    color?: { backgroundColor?: string; textColor?: string }
  ): Promise<string> {
    await this.ensureValidToken();

    const response = await this.gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        color,
      },
    });

    return response.data.id || '';
  }

  /**
   * Get all labels
   */
  async getLabels(): Promise<gmail_v1.Schema$Label[]> {
    await this.ensureValidToken();

    const response = await this.gmail.users.labels.list({
      userId: 'me',
    });

    return response.data.labels || [];
  }

  /**
   * Build Gmail query string from filter
   */
  private buildQuery(filter?: EmailFilter): string {
    const parts: string[] = [];

    if (filter?.sender) {
      parts.push(`from:${filter.sender}`);
    }

    if (filter?.subject) {
      parts.push(`subject:"${filter.subject}"`);
    }

    if (filter?.labels && filter.labels.length > 0) {
      parts.push(`label:${filter.labels.join(' label:')}`);
    }

    if (filter?.hasAttachment) {
      parts.push('has:attachment');
    }

    if (filter?.isRead !== undefined) {
      parts.push(filter.isRead ? 'is:read' : 'is:unread');
    }

    return parts.join(' ');
  }

  /**
   * Get rate limiter status
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus();
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.errorHandler.getCircuitBreakerStatus();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker() {
    this.errorHandler.reset();
  }

  /**
   * Delay execution helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Max chars of email body stored in a Gmail ZapRun payload (see D4 in
 * reports/gmail-worker-routing-spec.md; aligned with the AI step's input cap). */
export const GMAIL_BODY_MAX_CHARS = 20_000;

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Collect decoded bodies from a Gmail payload tree, partitioned by mime type. */
function collectBodies(part: any, out: { plain: string[]; html: string[] }): void {
  if (!part || typeof part !== 'object') return;

  const data = part.body?.data;
  if (typeof data === 'string' && data.length > 0 && !part.filename) {
    // Parts with a filename are attachments — never inlined into the payload.
    if (part.mimeType === 'text/plain') out.plain.push(decodeBase64Url(data));
    else if (part.mimeType === 'text/html') out.html.push(decodeBase64Url(data));
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) collectBodies(child, out);
  }
}

/**
 * Extract plain + html bodies (and the derived plain-text body) from a
 * Gmail `users.messages.get` payload (`format: 'full'`).
 *
 * `plain`/`html` satisfy the grilled payload contract (Q-GMAIL-03: both
 * forms present; each capped at GMAIL_BODY_MAX_CHARS, `truncated` when any
 * side was cut). `body` stays the historical plain-first derivation so
 * existing consumers/tests are unchanged.
 */
export function extractEmailParts(payload: any): {
  plain: string;
  html: string;
  body: string;
  truncated: boolean;
} {
  const found = { plain: [] as string[], html: [] as string[] };
  collectBodies(payload, found);

  const raw =
    found.plain.length > 0
      ? found.plain.join('\n').trim()
      : found.html.length > 0
        ? stripHtml(found.html.join('\n'))
        : '';

  const htmlRaw = found.html.length > 0 ? found.html.join('\n').trim() : '';
  const truncated = raw.length > GMAIL_BODY_MAX_CHARS || htmlRaw.length > GMAIL_BODY_MAX_CHARS;

  return {
    plain: raw.length > GMAIL_BODY_MAX_CHARS ? raw.slice(0, GMAIL_BODY_MAX_CHARS) : raw,
    html: htmlRaw.length > GMAIL_BODY_MAX_CHARS ? htmlRaw.slice(0, GMAIL_BODY_MAX_CHARS) : htmlRaw,
    body: raw.length > GMAIL_BODY_MAX_CHARS ? raw.slice(0, GMAIL_BODY_MAX_CHARS) : raw,
    truncated,
  };
}

/**
 * Extract a plain-text body from a Gmail `users.messages.get` payload
 * (`format: 'full'`). Prefers text/plain parts; falls back to stripped
 * text/html. Pure and synchronous so it is unit-testable without the
 * Gmail API. Applies the GMAIL_BODY_MAX_CHARS cap.
 */
export function extractEmailBody(payload: any): { body: string; truncated: boolean } {
  const { body, truncated } = extractEmailParts(payload);
  return { body, truncated };
}
