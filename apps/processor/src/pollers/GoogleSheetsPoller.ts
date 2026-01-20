/**
 * Google Sheets Poller
 * Polls Google Sheets for row updates using hash comparison
 */

import { google } from 'googleapis';
import crypto from 'crypto';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';
import { BasePoller } from './BasePoller';
import { PollResult } from './types';

interface UpdatedRow {
  row_number: number;
  row_data: Record<string, any>;
}

export class GoogleSheetsPoller extends BasePoller {
  name = 'google-sheets';
  emoji = '📊';

  /**
   * Hash a row using SHA-1 for change detection
   */
  private hashRow(values: any[]): string {
    const normalized = values.map((v) => (v ?? '').toString().trim()).join('|');
    return crypto.createHash('sha1').update(normalized).digest('hex');
  }

  /**
   * Get Redis key for storing row hashes
   */
  private getRedisKey(triggerId: string): string {
    return `sheets:trigger:${triggerId}:rowhash`;
  }

  /**
   * Main poll method - checks all active Google Sheets triggers for updates
   */
  async poll(): Promise<PollResult> {
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;

    this.logStart();

    try {
      // Get all active triggers with their servers
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

      console.log(`${this.emoji} Found ${triggers.length} active Google Sheets triggers`);

      for (const trigger of triggers) {
        try {
          const result = await this.pollTrigger(trigger);
          processed += result;
        } catch (error) {
          console.error(`${this.emoji} Error processing trigger ${trigger.id}:`, error);
          errors++;
        }
      }
    } catch (error) {
      console.error(`${this.emoji} Error in Google Sheets polling:`, error);
      errors++;
    }

    const duration = Date.now() - startTime;
    this.logComplete(processed, errors, duration);

    return { service: this.name, processed, errors, duration };
  }

  /**
   * Poll a single trigger for updates
   */
  private async pollTrigger(trigger: any): Promise<number> {
    // Initialize OAuth2 client
    const oauth2Client = this.getOAuthClient();
    this.setCredentials(oauth2Client, trigger.server);

    // Refresh token if needed
    await this.refreshTokenIfNeeded(trigger.server, oauth2Client, (id, data) =>
      client.googleSheetsServer.update({ where: { id }, data })
    );

    // Initialize Sheets API
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // Fetch spreadsheet data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: trigger.spreadsheetId,
      range: `${trigger.sheetName}!A:Z`,
    });

    const allRows = response.data.values || [];
    if (allRows.length === 0) {
      console.log(`${this.emoji} No data in sheet for trigger ${trigger.id}`);
      return 0;
    }

    // First row is headers
    const headers = (allRows[0] || []).map((h: any) => (h ?? '').toString());
    const dataRows = allRows.slice(1).map((values, idx) => ({
      index: idx + 2,
      values: values || [],
    }));

    const redisKey = this.getRedisKey(trigger.id);
    const updatedRows: UpdatedRow[] = [];

    for (const row of dataRows) {
      const rowKey = row.index.toString();
      const newHash = this.hashRow(row.values);

      // Get stored hash from Redis
      const oldHash = (await redis.hget(redisKey, rowKey)) as string | null;

      // Trigger on NEW rows (no oldHash) OR CHANGED rows (hash differs)
      const isNewRow = !oldHash;
      const isChangedRow = oldHash && oldHash !== newHash;

      if (isNewRow || isChangedRow) {
        const rowData: Record<string, any> = {};
        headers.forEach((header: string, idx: number) => {
          rowData[header] = row.values[idx] ?? '';
        });

        updatedRows.push({
          row_number: row.index,
          row_data: rowData,
        });

        console.log(`📊 ${isNewRow ? 'New' : 'Updated'} row ${row.index} in trigger ${trigger.id}`);
      }

      // Update hash in Redis
      await redis.hset(redisKey, { [rowKey]: newHash });
    }

    // Set TTL (30 days)
    await redis.expire(redisKey, 60 * 60 * 24 * 30);

    // Create ZapRun for each updated row
    for (const row of updatedRows) {
      await this.createZapRun(trigger.zapId, row);
    }

    // Update last polled timestamp
    await client.googleSheetsTrigger.update({
      where: { id: trigger.id },
      data: { lastPolledAt: new Date() },
    });

    return updatedRows.length;
  }
}
