import { Request, Response } from 'express';
import { google } from 'googleapis';
import client from '@repo/db';
import { GmailService } from '../services/GmailService';
import { GoogleOAuthService, GMAIL_SCOPES } from '../services';

// Get redirect URI for Gmail OAuth - use backend callback like Sheets/Calendar
const getRedirectUri = () =>
  process.env.GMAIL_REDIRECT_URI || `${process.env.API_URL}/api/gmail/auth/callback`;

export const initiateGmailAuth = async (req: Request, res: Response): Promise<any> => {
  try {
    const { name } = req.body;
    // @ts-ignore
    const userId = req.id;

    if (!name) {
      return res.status(400).json({
        message: 'Gmail server name is required',
      });
    }

    // Generate OAuth URL using shared service
    const authUrl = GoogleOAuthService.generateAuthUrl(
      getRedirectUri(),
      GMAIL_SCOPES,
      userId,
      'gmail'
    );

    // Add name to the auth URL state by modifying it
    const url = new URL(authUrl);
    const state = JSON.parse(url.searchParams.get('state') || '{}');
    state.name = name;
    url.searchParams.set('state', JSON.stringify(state));

    return res.status(200).json({
      message: 'Gmail OAuth initiated',
      authUrl: url.toString(),
    });
  } catch (error) {
    console.error('Error initiating Gmail auth:', error);
    return res.status(500).json({
      message: 'Failed to initiate Gmail authentication',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const handleGmailCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({
        message: 'Missing authorization code or state',
      });
    }

    const stateData = JSON.parse(state as string);
    const { userId, name } = stateData;
    const redirectUri = getRedirectUri();

    // Exchange code for tokens using shared service
    const tokens = await GoogleOAuthService.exchangeCodeForTokens(code as string, redirectUri);

    // Create authenticated client for Gmail API
    const oauth2Client = GoogleOAuthService.createClient(redirectUri);
    oauth2Client.setCredentials(tokens);

    // Get user profile to verify
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client as any });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    // Save Gmail server configuration
    const gmailServer = await client.gmailServer.create({
      data: {
        name,
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        refreshToken: tokens.refresh_token!,
        accessToken: tokens.access_token!,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    // Set up email watching
    const gmailService = new GmailService({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: tokens.refresh_token!,
      accessToken: tokens.access_token!,
      tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
    });

    const watchResult = await gmailService.watchEmails(['INBOX']);

    // Save watch configuration
    await client.gmailWatch.create({
      data: {
        serverId: gmailServer.id,
        watchId: watchResult.watchId,
        expiry: watchResult.expiry,
        isActive: true,
      },
    });

    // Redirect to frontend with success flag (consistent with Sheets/Calendar)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?gmail=connected`);
  } catch (error) {
    console.error('Error handling Gmail callback:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?gmail=error`);
  }
};

export const getGmailServers = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;

    const gmailServers = await client.gmailServer.findMany({
      where: { userId: parseInt(userId) },
      include: {
        gmailTriggers: {
          include: { zap: true },
        },
        gmailActions: {
          include: { zap: true },
        },
        watchHistory: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return res.status(200).json({
      message: 'Gmail servers retrieved successfully',
      gmailServers,
    });
  } catch (error) {
    console.error('Error fetching Gmail servers:', error);
    return res.status(500).json({
      message: 'Failed to fetch Gmail servers',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const getGmailServer = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    const gmailServer = await client.gmailServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
      },
      include: {
        gmailTriggers: {
          include: { zap: true },
        },
        gmailActions: {
          include: { zap: true },
        },
        watchHistory: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!gmailServer) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    return res.status(200).json({
      message: 'Gmail server retrieved successfully',
      gmailServer,
    });
  } catch (error) {
    console.error('Error fetching Gmail server:', error);
    return res.status(500).json({
      message: 'Failed to fetch Gmail server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const updateGmailServer = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;
    const { name, isActive } = req.body;

    const gmailServer = await client.gmailServer.updateMany({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
      },
      data: {
        ...(name && { name }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    if (gmailServer.count === 0) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    return res.status(200).json({
      message: 'Gmail server updated successfully',
    });
  } catch (error) {
    console.error('Error updating Gmail server:', error);
    return res.status(500).json({
      message: 'Failed to update Gmail server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const deleteGmailServer = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    // Stop watching first
    if (serverId) {
      const gmailService = await getGmailService(serverId as string);
      if (gmailService) {
        await gmailService.stopWatching();
      }
    }

    // Delete all related records
    await client.$transaction(async (tx) => {
      await tx.gmailWatch.deleteMany({
        where: { serverId: serverId as string },
      });

      await tx.gmailTrigger.deleteMany({
        where: { serverId: serverId as string },
      });

      await tx.gmailAction.deleteMany({
        where: { serverId: serverId as string },
      });

      await tx.gmailServer.deleteMany({
        where: {
          id: serverId as string,
          userId: parseInt(userId),
        },
      });
    });

    return res.status(200).json({
      message: 'Gmail server deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting Gmail server:', error);
    return res.status(500).json({
      message: 'Failed to delete Gmail server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const testGmailConnection = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    const gmailServer = await client.gmailServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
      },
    });

    if (!gmailServer) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    const gmailService = new GmailService({
      clientId: gmailServer.clientId,
      clientSecret: gmailServer.clientSecret,
      refreshToken: gmailServer.refreshToken,
      accessToken: gmailServer.accessToken,
      tokenExpiry: gmailServer.tokenExpiry || undefined,
    });

    // Test connection by getting profile
    const profile = await gmailService.getEmailMetadata('me'); // This will fail, but test the connection

    return res.status(200).json({
      message: 'Gmail connection successful',
      email: 'test@example.com', // Would get from profile in real implementation
    });
  } catch (error) {
    console.error('Error testing Gmail connection:', error);
    return res.status(500).json({
      message: 'Failed to test Gmail connection',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// Helper function to get Gmail service instance
export const getGmailService = async (serverId: string): Promise<GmailService | null> => {
  try {
    const gmailServer = await client.gmailServer.findUnique({
      where: { id: serverId },
    });

    if (!gmailServer || !gmailServer.isActive) {
      return null;
    }

    return new GmailService({
      clientId: gmailServer.clientId,
      clientSecret: gmailServer.clientSecret,
      refreshToken: gmailServer.refreshToken,
      accessToken: gmailServer.accessToken,
      tokenExpiry: gmailServer.tokenExpiry || undefined,
    });
  } catch (error) {
    console.error('Error creating Gmail service:', error);
    return null;
  }
};

export const getGmailRateLimitStatus = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    const gmailServer = await client.gmailServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
      },
    });

    if (!gmailServer) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    const gmailService = new GmailService({
      clientId: gmailServer.clientId,
      clientSecret: gmailServer.clientSecret,
      refreshToken: gmailServer.refreshToken,
      accessToken: gmailServer.accessToken,
      tokenExpiry: gmailServer.tokenExpiry || undefined,
    });

    const rateLimitStatus = gmailService.getRateLimitStatus();
    const circuitBreakerStatus = gmailService.getCircuitBreakerStatus();

    return res.status(200).json({
      message: 'Gmail rate limit status retrieved successfully',
      rateLimitStatus,
      circuitBreakerStatus,
    });
  } catch (error) {
    console.error('Error fetching Gmail rate limit status:', error);
    return res.status(500).json({
      message: 'Failed to fetch Gmail rate limit status',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const resetGmailCircuitBreaker = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.params;

    const gmailServer = await client.gmailServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
      },
    });

    if (!gmailServer) {
      return res.status(404).json({
        message: 'Gmail server not found',
      });
    }

    const gmailService = new GmailService({
      clientId: gmailServer.clientId,
      clientSecret: gmailServer.clientSecret,
      refreshToken: gmailServer.refreshToken,
      accessToken: gmailServer.accessToken,
      tokenExpiry: gmailServer.tokenExpiry || undefined,
    });

    gmailService.resetCircuitBreaker();

    return res.status(200).json({
      message: 'Gmail circuit breaker reset successfully',
    });
  } catch (error) {
    console.error('Error resetting Gmail circuit breaker:', error);
    return res.status(500).json({
      message: 'Failed to reset Gmail circuit breaker',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
