import { google, sheets_v4 } from 'googleapis';
import crypto from 'crypto';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';
import { Prisma } from '@prisma/client';

export interface GoogleSheetsConfig {
    refreshToken: string;
    accessToken?: string;
    tokenExpiry?: Date;
}

export interface UpdatedRow {
    row_number: number;
    row_data: Record<string, any>;
}

export class GoogleSheetsService {
    private oauth2Client: any;
    private sheets: sheets_v4.Sheets;
    private serverId: string;

    constructor(config: GoogleSheetsConfig, serverId: string) {
        this.serverId = serverId;

        // Initialize OAuth2 client
        this.oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            process.env.GOOGLE_REDIRECT_URI
        );

        // Set credentials
        this.oauth2Client.setCredentials({
            refresh_token: config.refreshToken,
            access_token: config.accessToken,
            expiry_date: config.tokenExpiry?.getTime(),
        });

        // Initialize Sheets API client
        this.sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    }

    /**
     * Hash a row using SHA-1
     * Converts row values to a stable string format and hashes
     */
    static hashRow(values: any[]): string {
        // Normalize values: trim whitespace, treat empty/null as empty string
        const normalized = values
            .map(v => (v ?? '').toString().trim())
            .join('|');
        return crypto.createHash('sha1').update(normalized).digest('hex');
    }

    /**
     * Get Redis key for a trigger's row hashes
     */
    static getRedisKey(triggerId: string): string {
        return `sheets:trigger:${triggerId}:rowhash`;
    }

    /**
     * Refresh access token if expired
     */
    private async ensureValidToken(): Promise<void> {
        const now = new Date();
        const expiryTime = this.oauth2Client.credentials.expiry_date;

        if (!expiryTime || now.getTime() >= expiryTime - 60000) {
            const { credentials } = await this.oauth2Client.refreshAccessToken();
            this.oauth2Client.setCredentials(credentials);

            // Update database with new token
            if (credentials.access_token && credentials.expiry_date) {
                await client.googleSheetsServer.update({
                    where: { id: this.serverId },
                    data: {
                        accessToken: credentials.access_token,
                        tokenExpiry: new Date(credentials.expiry_date),
                    },
                });
            }
        }
    }

    /**
     * Fetch all rows from a spreadsheet
     */
    async getSpreadsheetData(spreadsheetId: string, sheetName: string): Promise<{
        headers: string[];
        rows: { index: number; values: any[] }[];
    }> {
        await this.ensureValidToken();

        const response = await this.sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:Z`,
        });

        const allRows = response.data.values || [];

        if (allRows.length === 0) {
            return { headers: [], rows: [] };
        }

        // First row is headers
        const headers = (allRows[0] || []).map((h: any) => (h ?? '').toString());

        // Data rows start at index 2 (1-indexed, skip header)
        const rows = allRows.slice(1).map((values, idx) => ({
            index: idx + 2, // Row 2, 3, 4, etc. (1-indexed, header is row 1)
            values: values || [],
        }));

        return { headers, rows };
    }

    /**
     * Poll for updated rows
     * Returns rows that have changed since last poll
     */
    async pollForUpdates(triggerId: string, spreadsheetId: string, sheetName: string): Promise<UpdatedRow[]> {
        try {
            const { headers, rows } = await this.getSpreadsheetData(spreadsheetId, sheetName);

            if (headers.length === 0 || rows.length === 0) {
                console.log(`📊 No data in sheet ${sheetName} for trigger ${triggerId}`);
                return [];
            }

            const redisKey = GoogleSheetsService.getRedisKey(triggerId);
            const updatedRows: UpdatedRow[] = [];

            for (const row of rows) {
                const rowKey = row.index.toString();
                const newHash = GoogleSheetsService.hashRow(row.values);

                // Get stored hash from Redis
                const oldHash = await redis.hget(redisKey, rowKey) as string | null;

                // Check if row was updated (existed before AND hash changed)
                if (oldHash && oldHash !== newHash) {
                    // Build row data object with column headers
                    const rowData: Record<string, any> = {};
                    headers.forEach((header, idx) => {
                        rowData[header] = row.values[idx] ?? '';
                    });

                    updatedRows.push({
                        row_number: row.index,
                        row_data: rowData,
                    });

                    console.log(`📝 Row ${row.index} updated in trigger ${triggerId}`);
                }

                // Update hash in Redis (for both new and existing rows)
                await redis.hset(redisKey, { [rowKey]: newHash });
            }

            // Set TTL (30 days) - auto-cleanup for orphaned triggers
            await redis.expire(redisKey, 60 * 60 * 24 * 30);

            return updatedRows;
        } catch (error) {
            console.error(`❌ Error polling trigger ${triggerId}:`, error);
            throw error;
        }
    }

    /**
     * Get spreadsheet metadata
     */
    async getSpreadsheetInfo(spreadsheetId: string): Promise<{
        title: string;
        sheets: { name: string; index: number }[];
    }> {
        await this.ensureValidToken();

        const response = await this.sheets.spreadsheets.get({
            spreadsheetId,
            fields: 'properties.title,sheets.properties',
        });

        return {
            title: response.data.properties?.title || 'Unknown',
            sheets: (response.data.sheets || []).map(sheet => ({
                name: sheet.properties?.title || 'Sheet1',
                index: sheet.properties?.index || 0,
            })),
        };
    }

    /**
     * Validate spreadsheet access
     */
    async validateAccess(spreadsheetId: string): Promise<boolean> {
        try {
            await this.ensureValidToken();
            await this.sheets.spreadsheets.get({
                spreadsheetId,
                fields: 'spreadsheetId',
            });
            return true;
        } catch (error) {
            console.error('❌ Cannot access spreadsheet:', error);
            return false;
        }
    }

    /**
     * Static method to poll all active triggers
     * Called by the processor service
     */
    static async pollAllTriggers(): Promise<void> {
        console.log('📊 Starting Google Sheets trigger polling...');

        // Get all active triggers
        const triggers = await client.googleSheetsTrigger.findMany({
            where: {
                isActive: true,
                zap: { isActive: true },
            },
            include: {
                server: true,
                zap: true,
            },
        });

        console.log(`📊 Found ${triggers.length} active Google Sheets triggers`);

        for (const trigger of triggers) {
            try {
                // Create service instance for this trigger's server
                const service = new GoogleSheetsService(
                    {
                        refreshToken: trigger.server.refreshToken,
                        accessToken: trigger.server.accessToken,
                        tokenExpiry: trigger.server.tokenExpiry || undefined,
                    },
                    trigger.server.id
                );

                // Poll for updates
                const updatedRows = await service.pollForUpdates(
                    trigger.id,
                    trigger.spreadsheetId,
                    trigger.sheetName
                );

                // Create ZapRun for each updated row
                for (const row of updatedRows) {
                    const zapRun = await client.zapRun.create({
                        data: {
                            zapId: trigger.zapId,
                            // Convert to plain JSON object for Prisma
                            metadata: JSON.parse(JSON.stringify(row)),
                        },
                    });

                    // Add to outbox for action execution
                    await client.zapRunOutbox.create({
                        data: {
                            zapRunId: zapRun.id,
                        },
                    });

                    console.log(`✅ Created ZapRun ${zapRun.id} for row ${row.row_number}`);
                }

                // Update last polled timestamp
                await client.googleSheetsTrigger.update({
                    where: { id: trigger.id },
                    data: { lastPolledAt: new Date() },
                });

            } catch (error) {
                console.error(`❌ Error processing trigger ${trigger.id}:`, error);
                // Continue with next trigger
            }
        }

        console.log('📊 Google Sheets trigger polling complete');
    }
}

export default GoogleSheetsService;
