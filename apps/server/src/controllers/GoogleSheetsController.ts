import { Request, Response } from 'express';
import { google } from 'googleapis';
import client from '@repo/db';
import { GoogleSheetsService } from '../services/GoogleSheetsService';
import { GoogleOAuthService, SHEETS_SCOPES } from '../services';

// Get redirect URI from environment
const getRedirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI || `${process.env.API_URL}/api/sheets/auth/callback`;

/**
 * Initiate Google OAuth flow
 */
export const initiateAuth = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;

    const authUrl = GoogleOAuthService.generateAuthUrl(
      getRedirectUri(),
      SHEETS_SCOPES,
      userId,
      'google-sheets'
    );

    console.log('✅ Generated OAuth URL for user:', userId);

    return res.status(200).json({
      message: 'OAuth URL generated',
      authUrl,
    });
  } catch (error) {
    console.error('❌ Error initiating OAuth:', error);
    return res.status(500).json({
      message: 'Failed to initiate OAuth',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Handle OAuth callback from Google
 */
export const handleCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ message: 'Authorization code is required' });
    }

    // Parse state to get user ID using shared service
    const { userId } = GoogleOAuthService.parseState(state as string);
    const redirectUri = getRedirectUri();

    // Exchange code for tokens using shared service
    const tokens = await GoogleOAuthService.exchangeCodeForTokens(code, redirectUri);

    // Get user email using shared service
    const email = await GoogleOAuthService.getUserEmail(tokens.access_token || '', redirectUri);

    // Check if server already exists for this user and email
    const existingServer = await client.googleSheetsServer.findFirst({
      where: {
        userId,
        email,
      },
    });

    if (existingServer) {
      // Update existing server
      await client.googleSheetsServer.update({
        where: { id: existingServer.id },
        data: {
          accessToken: tokens.access_token || '',
          refreshToken: tokens.refresh_token || existingServer.refreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
    } else {
      // Create new server
      await client.googleSheetsServer.create({
        data: {
          name: `Google Sheets - ${email}`,
          email,
          refreshToken: tokens.refresh_token || '',
          accessToken: tokens.access_token || '',
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          userId,
        },
      });
    }

    // Redirect to frontend - Editor page with success flag
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?sheets=connected`);
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?sheets=error`);
  }
};

/**
 * Get user's connected Google Sheets accounts
 */
export const getServers = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;

    const servers = await client.googleSheetsServer.findMany({
      where: {
        userId: parseInt(userId),
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: { triggers: true },
        },
      },
    });

    return res.status(200).json({
      message: 'Servers retrieved successfully',
      servers,
    });
  } catch (error) {
    console.error('❌ Error fetching servers:', error);
    return res.status(500).json({
      message: 'Failed to fetch servers',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Delete/disconnect a Google Sheets server
 */
export const deleteServer = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const serverId = req.params.serverId as string;

    // Verify ownership
    const server = await client.googleSheetsServer.findFirst({
      where: {
        id: serverId,
        userId: parseInt(userId),
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    // Soft delete - mark as inactive
    await client.googleSheetsServer.update({
      where: { id: serverId },
      data: { isActive: false },
    });

    // Also deactivate all triggers for this server
    await client.googleSheetsTrigger.updateMany({
      where: { serverId },
      data: { isActive: false },
    });

    return res.status(200).json({
      message: 'Server disconnected successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting server:', error);
    return res.status(500).json({
      message: 'Failed to delete server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * List user's spreadsheets (requires Drive API scope)
 */
export const listSpreadsheets = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.query;

    if (!serverId) {
      return res.status(400).json({ message: 'Server ID is required' });
    }

    const server = await client.googleSheetsServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    // Note: This requires Drive API scope to list files
    // For now, return instructions to manually enter spreadsheet ID
    return res.status(200).json({
      message: 'Enter spreadsheet ID manually',
      instructions:
        'Copy the spreadsheet ID from the URL: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit',
    });
  } catch (error) {
    console.error('❌ Error listing spreadsheets:', error);
    return res.status(500).json({
      message: 'Failed to list spreadsheets',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get sheet names from a spreadsheet
 */
export const getSheetNames = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { id: spreadsheetId } = req.params;
    const { serverId } = req.query;

    if (!serverId) {
      return res.status(400).json({ message: 'Server ID is required' });
    }

    const server = await client.googleSheetsServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    const service = new GoogleSheetsService(
      {
        refreshToken: server.refreshToken,
        accessToken: server.accessToken,
        tokenExpiry: server.tokenExpiry || undefined,
      },
      server.id
    );

    if (!spreadsheetId) {
      return res.status(400).json({ message: 'Spreadsheet ID is required' });
    }

    const sheetId = Array.isArray(spreadsheetId) ? spreadsheetId[0] : spreadsheetId;
    if (!sheetId) {
      return res.status(400).json({ message: 'Spreadsheet ID is required' });
    }
    const info = await service.getSpreadsheetInfo(sheetId);

    return res.status(200).json({
      message: 'Sheet names retrieved',
      spreadsheet: info,
    });
  } catch (error) {
    console.error('❌ Error getting sheet names:', error);
    return res.status(500).json({
      message: 'Failed to get sheet names',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
