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

export class GmailService {
  private oauth2Client: any;
  private gmail: gmail_v1.Gmail;
  private rateLimiter: GmailRateLimiter;
  private errorHandler: GmailErrorHandler;

  constructor(config: GmailConfig) {
    // @ts-ignore - OAuth2Client version conflict between googleapis and google-auth-library
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret
    );

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

    if (!expiryTime || now.getTime() >= expiryTime - 60000) { // Refresh 1 minute before expiry
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      this.oauth2Client.setCredentials(credentials);

      // Update database with new token
      if (credentials.access_token && credentials.expiry_date) {
        await client.gmailServer.updateMany({
          where: { clientId: this.oauth2Client._clientId! },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date),
          },
        });
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
          topicName: process.env.GMAIL_PUBSUB_TOPIC || 'projects/your-project/topics/gmail-notifications',
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
      const getHeader = (name: string) => headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      return {
        id: response.data.id || '',
        threadId: response.data.threadId || '',
        snippet: response.data.snippet || '',
        from: getHeader('From'),
        to: getHeader('To').split(',').map((email: string) => email.trim()),
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
   * Send email
   */
  async sendEmail(to: string[], subject: string, body: string, cc?: string[], bcc?: string[]): Promise<string> {
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
      ].filter(line => line).join('\r\n');

      const encodedEmail = Buffer.from(email).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

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
    const subject = originalEmail.subject.startsWith('Re: ') ? originalEmail.subject : `Re: ${originalEmail.subject}`;

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
  async createLabel(name: string, color?: { backgroundColor?: string; textColor?: string }): Promise<string> {
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
