import { google } from 'googleapis';

/**
 * Configuration for different Google services
 */
export interface GoogleServiceConfig {
  scopes: string[];
  redirectUri: string;
  serviceName: 'gmail' | 'sheets' | 'calendar';
}

/**
 * Token data from the database server record
 */
export interface TokenData {
  refreshToken: string;
  accessToken: string;
  tokenExpiry: Date | null;
}

/**
 * Result of token refresh operation
 */
export interface RefreshResult {
  accessToken: string;
  expiryDate: number;
  needsUpdate: boolean;
}

/**
 * Shared Google OAuth Service
 * Consolidates OAuth logic used across Gmail, Calendar, and Sheets controllers
 */
export class GoogleOAuthService {
  /**
   * Create an OAuth2 client with environment credentials
   */
  static createClient(redirectUri: string): any {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('Google OAuth credentials not configured');
    }

    return new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );
  }

  /**
   * Generate OAuth authorization URL
   */
  static generateAuthUrl(
    redirectUri: string,
    scopes: string[],
    userId: number,
    serviceName: string
  ): string {
    const oauth2Client = this.createClient(redirectUri);

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent', // Force consent to get refresh token
      state: JSON.stringify({ userId, service: serviceName }),
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  static async exchangeCodeForTokens(code: string, redirectUri: string): Promise<any> {
    const oauth2Client = this.createClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  /**
   * Get user email from access token
   */
  static async getUserEmail(accessToken: string, redirectUri: string): Promise<string> {
    const oauth2Client = this.createClient(redirectUri);
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    return userInfo.data.email || 'Unknown';
  }

  /**
   * Parse state parameter from OAuth callback
   */
  static parseState(state: string): { userId: number; service: string } {
    try {
      const parsed = JSON.parse(state);
      return {
        userId: parseInt(parsed.userId),
        service: parsed.service,
      };
    } catch {
      throw new Error('Invalid state parameter');
    }
  }

  /**
   * Refresh access token if expired or about to expire
   * Returns updated token data if refresh was needed
   */
  static async refreshTokenIfNeeded(
    tokenData: TokenData,
    redirectUri: string
  ): Promise<RefreshResult | null> {
    const now = Date.now();
    const expiryTime = tokenData.tokenExpiry?.getTime() || 0;
    const bufferMs = 60000; // 1 minute buffer

    // Token is still valid
    if (expiryTime > now + bufferMs) {
      return null;
    }

    // Need to refresh
    const oauth2Client = this.createClient(redirectUri);
    oauth2Client.setCredentials({
      refresh_token: tokenData.refreshToken,
      access_token: tokenData.accessToken,
      expiry_date: expiryTime,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Failed to refresh access token');
    }

    return {
      accessToken: credentials.access_token,
      expiryDate: credentials.expiry_date,
      needsUpdate: true,
    };
  }

  /**
   * Create an authenticated OAuth2 client from stored tokens
   */
  static createAuthenticatedClient(tokenData: TokenData, redirectUri: string): any {
    const oauth2Client = this.createClient(redirectUri);
    oauth2Client.setCredentials({
      refresh_token: tokenData.refreshToken,
      access_token: tokenData.accessToken,
      expiry_date: tokenData.tokenExpiry?.getTime(),
    });
    return oauth2Client;
  }
}

// Export scopes for each service
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];
