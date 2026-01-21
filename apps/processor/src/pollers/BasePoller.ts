/**
 * Abstract base class for all pollers
 * Provides common functionality for OAuth, token refresh, and ZapRun creation
 */

import { google } from 'googleapis';
import client from '@repo/db';
import { PollResult, OAuthServerBase } from './types';

export abstract class BasePoller {
  /**
   * Name identifier for this poller (e.g., 'google-sheets', 'google-calendar')
   */
  abstract name: string;

  /**
   * Emoji for logging
   */
  abstract emoji: string;

  /**
   * Main poll method to be implemented by each poller
   */
  abstract poll(): Promise<PollResult>;

  /**
   * Create an OAuth2 client with Google credentials
   */
  protected getOAuthClient() {
    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || `${process.env.API_URL}/api/sheets/auth/callback`
    );
  }

  /**
   * Set credentials on OAuth client from server data
   */
  protected setCredentials(
    oauth2Client: ReturnType<typeof this.getOAuthClient>,
    server: OAuthServerBase
  ) {
    oauth2Client.setCredentials({
      refresh_token: server.refreshToken,
      access_token: server.accessToken,
      expiry_date: server.tokenExpiry?.getTime(),
    });
  }

  /**
   * Refresh token if expired or about to expire (within 1 minute)
   * @param server - Server with OAuth tokens
   * @param oauth2Client - OAuth2 client
   * @param updateFn - Function to update server with new tokens
   */
  protected async refreshTokenIfNeeded(
    server: OAuthServerBase,
    oauth2Client: ReturnType<typeof this.getOAuthClient>,
    updateFn: (id: string, data: { accessToken: string; tokenExpiry: Date }) => Promise<any>
  ): Promise<void> {
    const now = Date.now();
    const expiryTime = server.tokenExpiry?.getTime();

    if (!expiryTime || now >= expiryTime - 60000) {
      console.log(`${this.emoji} Refreshing token for server ${server.id}`);
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      if (credentials.access_token && credentials.expiry_date) {
        await updateFn(server.id, {
          accessToken: credentials.access_token,
          tokenExpiry: new Date(credentials.expiry_date),
        });
      }
    }
  }

  /**
   * Create a ZapRun and add to outbox for processing
   */
  protected async createZapRun(zapId: string, metadata: any): Promise<string> {
    const zapRun = await client.zapRun.create({
      data: {
        zapId,
        metadata: JSON.parse(JSON.stringify(metadata)),
      },
    });

    await client.zapRunOutbox.create({
      data: {
        zapRunId: zapRun.id,
      },
    });

    console.log(`${this.emoji} Created ZapRun ${zapRun.id}`);
    return zapRun.id;
  }

  /**
   * Helper to measure execution time
   */
  protected measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = Date.now();
    return fn().then((result) => ({
      result,
      duration: Date.now() - startTime,
    }));
  }

  /**
   * Log poll start
   */
  protected logStart(): void {
    console.log(`${this.emoji} Starting ${this.name} polling...`);
  }

  /**
   * Log poll complete
   */
  protected logComplete(processed: number, errors: number, duration: number): void {
    console.log(
      `${this.emoji} ${this.name} polling complete: ${processed} processed, ${errors} errors, ${duration}ms`
    );
  }
}
