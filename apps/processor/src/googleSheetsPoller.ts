import { google, sheets_v4 } from 'googleapis';
import crypto from 'crypto';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';

interface UpdatedRow {
  row_number: number;
  row_data: Record<string, any>;
}

/**
 * Hash a row using SHA-1
 */
function hashRow(values: any[]): string {
  const normalized = values.map((v) => (v ?? '').toString().trim()).join('|');
  return crypto.createHash('sha1').update(normalized).digest('hex');
}

/**
 * Get Redis key for a trigger's row hashes
 */
function getRedisKey(triggerId: string): string {
  return `sheets:trigger:${triggerId}:rowhash`;
}

/**
 * Poll all active Google Sheets triggers
 */
export async function pollGoogleSheetsTriggers(): Promise<{ processed: number; errors: number }> {
  console.log('📊 Starting Google Sheets trigger polling...');

  let processed = 0;
  let errors = 0;

  try {
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
        // Initialize OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI || `${process.env.API_URL}/api/sheets/auth/callback`
        );

        oauth2Client.setCredentials({
          refresh_token: trigger.server.refreshToken,
          access_token: trigger.server.accessToken,
          expiry_date: trigger.server.tokenExpiry?.getTime(),
        });

        // Check if token needs refresh
        const now = new Date();
        const expiryTime = trigger.server.tokenExpiry?.getTime();
        if (!expiryTime || now.getTime() >= expiryTime - 60000) {
          const { credentials } = await oauth2Client.refreshAccessToken();
          oauth2Client.setCredentials(credentials);

          // Update database with new token
          if (credentials.access_token && credentials.expiry_date) {
            await client.googleSheetsServer.update({
              where: { id: trigger.server.id },
              data: {
                accessToken: credentials.access_token,
                tokenExpiry: new Date(credentials.expiry_date),
              },
            });
          }
        }

        // Initialize Sheets API
        const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

        // Fetch spreadsheet data
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: trigger.spreadsheetId,
          range: `${trigger.sheetName}!A:Z`,
        });

        const allRows = response.data.values || [];
        if (allRows.length === 0) {
          console.log(`📊 No data in sheet for trigger ${trigger.id}`);
          continue;
        }

        // First row is headers
        const headers = (allRows[0] || []).map((h: any) => (h ?? '').toString());
        const dataRows = allRows.slice(1).map((values, idx) => ({
          index: idx + 2,
          values: values || [],
        }));

        const redisKey = getRedisKey(trigger.id);
        const updatedRows: UpdatedRow[] = [];

        for (const row of dataRows) {
          const rowKey = row.index.toString();
          const newHash = hashRow(row.values);

          // Get stored hash from Redis
          const oldHash = (await redis.hget(redisKey, rowKey)) as string | null;

          // Check if row was updated (existed before AND hash changed)
          if (oldHash && oldHash !== newHash) {
            const rowData: Record<string, any> = {};
            headers.forEach((header: string, idx: number) => {
              rowData[header] = row.values[idx] ?? '';
            });

            updatedRows.push({
              row_number: row.index,
              row_data: rowData,
            });

            console.log(`📝 Row ${row.index} updated in trigger ${trigger.id}`);
          }

          // Update hash in Redis
          await redis.hset(redisKey, { [rowKey]: newHash });
        }

        // Set TTL (30 days)
        await redis.expire(redisKey, 60 * 60 * 24 * 30);

        // Create ZapRun for each updated row
        for (const row of updatedRows) {
          const zapRun = await client.zapRun.create({
            data: {
              zapId: trigger.zapId,
              metadata: JSON.parse(JSON.stringify(row)),
            },
          });

          await client.zapRunOutbox.create({
            data: {
              zapRunId: zapRun.id,
            },
          });

          console.log(`✅ Created ZapRun ${zapRun.id} for row ${row.row_number}`);
          processed++;
        }

        // Update last polled timestamp
        await client.googleSheetsTrigger.update({
          where: { id: trigger.id },
          data: { lastPolledAt: new Date() },
        });
      } catch (error) {
        console.error(`❌ Error processing trigger ${trigger.id}:`, error);
        errors++;
      }
    }
  } catch (error) {
    console.error('❌ Error in Google Sheets polling:', error);
    errors++;
  }

  console.log(`📊 Google Sheets polling complete: ${processed} rows processed, ${errors} errors`);
  return { processed, errors };
}
