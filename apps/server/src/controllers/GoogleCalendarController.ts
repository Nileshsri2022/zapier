import { Request, Response } from 'express';
import { google } from 'googleapis';
import client from '@repo/db';
import { GoogleOAuthService, CALENDAR_SCOPES } from '../services';

// Get redirect URI from environment
const getRedirectUri = () =>
  process.env.GOOGLE_CALENDAR_REDIRECT_URI ||
  process.env.GOOGLE_REDIRECT_URI?.replace('sheets', 'calendar') ||
  '';

/**
 * Initiate Google Calendar OAuth flow
 */
export const initiateAuth = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;

    const authUrl = GoogleOAuthService.generateAuthUrl(
      getRedirectUri(),
      CALENDAR_SCOPES,
      userId,
      'google-calendar'
    );

    console.log('📅 Generated Calendar OAuth URL for user:', userId);

    return res.status(200).json({
      message: 'OAuth URL generated',
      authUrl,
    });
  } catch (error) {
    console.error('❌ Error initiating Calendar OAuth:', error);
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
    const existingServer = await client.googleCalendarServer.findFirst({
      where: {
        userId,
        email,
      },
    });

    if (existingServer) {
      // Update existing server
      await client.googleCalendarServer.update({
        where: { id: existingServer.id },
        data: {
          accessToken: tokens.access_token || '',
          refreshToken: tokens.refresh_token || existingServer.refreshToken,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });
      console.log('📅 Updated existing Calendar server for:', email);
    } else {
      // Create new server
      await client.googleCalendarServer.create({
        data: {
          email,
          refreshToken: tokens.refresh_token || '',
          accessToken: tokens.access_token || '',
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
          userId,
        },
      });
      console.log('📅 Created new Calendar server for:', email);
    }

    // Redirect to frontend with success flag
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?calendar=connected`);
  } catch (error) {
    console.error('❌ Calendar OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return res.redirect(`${frontendUrl}/editor?calendar=error`);
  }
};

/**
 * Get user's connected Google Calendar accounts
 */
export const getServers = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;

    const servers = await client.googleCalendarServer.findMany({
      where: {
        userId: parseInt(userId),
        isActive: true,
      },
      select: {
        id: true,
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
    console.error('❌ Error fetching Calendar servers:', error);
    return res.status(500).json({
      message: 'Failed to fetch servers',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Delete/disconnect a Google Calendar server
 */
export const deleteServer = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const serverId = req.params.serverId as string;

    // Verify ownership
    const server = await client.googleCalendarServer.findFirst({
      where: {
        id: serverId,
        userId: parseInt(userId),
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    // Soft delete - mark as inactive
    await client.googleCalendarServer.update({
      where: { id: serverId },
      data: { isActive: false },
    });

    // Also deactivate all triggers for this server
    await client.googleCalendarTrigger.updateMany({
      where: { serverId },
      data: { isActive: false },
    });

    return res.status(200).json({
      message: 'Calendar server disconnected successfully',
    });
  } catch (error) {
    console.error('❌ Error deleting Calendar server:', error);
    return res.status(500).json({
      message: 'Failed to delete server',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * List user's calendars
 */
export const listCalendars = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId } = req.query;

    if (!serverId) {
      return res.status(400).json({ message: 'Server ID is required' });
    }

    const server = await client.googleCalendarServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    const oauth2Client = GoogleOAuthService.createAuthenticatedClient(
      {
        refreshToken: server.refreshToken,
        accessToken: server.accessToken,
        tokenExpiry: server.tokenExpiry,
      },
      getRedirectUri()
    );

    // Refresh token if needed
    const now = Date.now();
    if (server.tokenExpiry && now >= server.tokenExpiry.getTime() - 60000) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(credentials);

      if (credentials.access_token && credentials.expiry_date) {
        await client.googleCalendarServer.update({
          where: { id: server.id },
          data: {
            accessToken: credentials.access_token,
            tokenExpiry: new Date(credentials.expiry_date),
          },
        });
      }
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.calendarList.list();

    const calendars = (response.data.items || []).map((cal) => ({
      id: cal.id,
      summary: cal.summary,
      description: cal.description,
      primary: cal.primary,
      backgroundColor: cal.backgroundColor,
    }));

    return res.status(200).json({
      message: 'Calendars retrieved successfully',
      calendars,
    });
  } catch (error) {
    console.error('❌ Error listing calendars:', error);
    return res.status(500).json({
      message: 'Failed to list calendars',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get upcoming events from a calendar (for testing/preview)
 */
export const getEvents = async (req: Request, res: Response): Promise<any> => {
  try {
    // @ts-ignore
    const userId = req.id;
    const { serverId, calendarId = 'primary', maxResults = 10 } = req.query;

    if (!serverId) {
      return res.status(400).json({ message: 'Server ID is required' });
    }

    const server = await client.googleCalendarServer.findFirst({
      where: {
        id: serverId as string,
        userId: parseInt(userId),
        isActive: true,
      },
    });

    if (!server) {
      return res.status(404).json({ message: 'Server not found' });
    }

    const oauth2Client = GoogleOAuthService.createAuthenticatedClient(
      {
        refreshToken: server.refreshToken,
        accessToken: server.accessToken,
        tokenExpiry: server.tokenExpiry,
      },
      getRedirectUri()
    );

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const response = await calendar.events.list({
      calendarId: calendarId as string,
      timeMin: new Date().toISOString(),
      maxResults: parseInt(maxResults as string),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = (response.data.items || []).map((event) => ({
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      location: event.location,
      status: event.status,
    }));

    return res.status(200).json({
      message: 'Events retrieved successfully',
      events,
    });
  } catch (error) {
    console.error('❌ Error fetching events:', error);
    return res.status(500).json({
      message: 'Failed to fetch events',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
