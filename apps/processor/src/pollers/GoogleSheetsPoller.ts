/**
 * Google Sheets Poller
 * Polls Google Sheets for row events using hash comparison.
 *
 * Spec: docs/ask-matt/triggers/google-sheets.md (grilled round 4)
 * - Event typing comes from the Zap's availableTrigger type:
 *     'Google Sheets New Row'  -> fires ONLY on appended rows (event 'created')
 *     'Google Sheets Updated Row' / anything legacy -> new + changed rows
 * - Contract: rowData (header-keyed OR col_N for headerless sheets) +
 *   rowArray + rowNumber + event + sheetName/spreadsheetId/spreadsheetName
 *   (+ legacy row_data/row_number aliases so existing zaps keep mapping)
 * - Headerless detection: first row has no non-numeric, non-empty cell ->
 *   it is DATA, keys fall back to col_1..col_n (Q-SHEETS-04)
 * - Fully-empty rows never fire (Q-SHEETS spec §5)
 */

import { google } from 'googleapis';
import crypto from 'crypto';
// @ts-ignore - Redis module will be available after build
import redis from '@repo/redis';
import client from '@repo/db';
import { BasePoller } from './BasePoller';
import { PollResult } from './types';

function quoteSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

interface SheetsRowEvent {
  row_number: number;
  row_data: Record<string, any>;
  row_array: any[];
  event: 'created' | 'updated';
  rowHash: string;
}

/**
 * Is `firstRow` a header row? Headers contain at least one cell that is
 * neither empty nor a plain number. All-numeric / all-empty first rows are
 * treated as data (headerless sheets, Q-SHEETS-04).
 */
export function looksLikeHeaderRow(firstRow: any[]): boolean {
  return firstRow.some((cell) => {
    const s = (cell ?? '').toString().trim();
    if (s === '') return false;
    return Number.isNaN(Number(s));
  });
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
   * Main poll method - checks all active Google Sheets triggers for events
   */
  async poll(): Promise<PollResult> {
    const startTime = Date.now();
    let processed = 0;
    let errors = 0;

    this.logStart();

    try {
      // Get all active triggers with their servers, plus the Zap's
      // availableTrigger type so event semantics (New Row vs Updated Row)
      // can be applied per Zap (docs/ask-matt T2).
      const triggers = await client.googleSheetsTrigger.findMany({
        where: {
          isActive: true,
          zap: { isActive: true },
        },
        include: {
          server: true,
          zap: {
            include: {
              trigger: {
                include: {
                  trigger: true,
                },
              },
            },
          },
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
   * Poll a single trigger for row events
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

    // Event mode: New Row fires only on appends; everything else (including
    // legacy zaps without a recognized type) keeps new+updated behavior.
    const availableType: string | undefined = trigger?.zap?.trigger?.trigger?.type;
    const newRowOnly = availableType === 'Google Sheets New Row';

    // Fetch spreadsheet data
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: trigger.spreadsheetId,
      range: `${quoteSheetName(trigger.sheetName)}!A:Z`,
    });

    const allRows = response.data.values || [];
    if (allRows.length === 0) {
      console.log(`${this.emoji} No data in sheet for trigger ${trigger.id}`);
      return 0;
    }

    // Header handling: real headers -> keys from row 1, data from row 2;
    // headerless (all-numeric/empty first row) -> data includes row 1 with
    // col_1..col_n keys (Q-SHEETS-04).
    const headerless = !looksLikeHeaderRow(allRows[0] || []);
    const headers = headerless
      ? []
      : (allRows[0] || []).map((h: any) => (h ?? '').toString());
    const dataRows = (headerless ? allRows : allRows.slice(1)).map((values, idx) => ({
      index: (headerless ? 1 : 2) + idx,
      values: values || [],
    }));

    const redisKey = this.getRedisKey(trigger.id);
    const fireRows: SheetsRowEvent[] = [];

    for (const row of dataRows) {
      // Fully-empty rows are skipped entirely — never fire, never hash
      // (spec §5: sparse/empty rows are not events).
      if (row.values.every((v: any) => (v ?? '').toString().trim() === '')) {
        continue;
      }

      const rowKey = row.index.toString();
      const newHash = this.hashRow(row.values);

      // Get stored hash from Redis
      const oldHash = (await redis.hget(redisKey, rowKey)) as string | null;

      const isNewRow = !oldHash;
      const isChangedRow = Boolean(oldHash) && oldHash !== newHash;

      // New Row mode drops in-place edits (they only refresh the hash).
      const shouldFire = isNewRow || (!newRowOnly && isChangedRow);

      if (shouldFire) {
        const rowData: Record<string, any> = {};
        if (headerless) {
          row.values.forEach((_v: any, idx: number) => {
            rowData[`col_${idx + 1}`] = row.values[idx] ?? '';
          });
        } else {
          headers.forEach((header: string, idx: number) => {
            rowData[header] = row.values[idx] ?? '';
          });
        }

        fireRows.push({
          row_number: row.index,
          row_data: rowData,
          row_array: [...row.values],
          event: isNewRow ? 'created' : 'updated',
          rowHash: newHash,
        });

        console.log(
          `${this.emoji} ${isNewRow ? 'New' : 'Updated'} row ${row.index} in trigger ${trigger.id}`
        );
      }

      // Update hash in Redis
      await redis.hset(redisKey, { [rowKey]: newHash });
    }

    // Set TTL (30 days)
    await redis.expire(redisKey, 60 * 60 * 24 * 30);

    if (fireRows.length === 0) {
      await client.googleSheetsTrigger.update({
        where: { id: trigger.id },
        data: { lastPolledAt: new Date() },
      });
      return 0;
    }

    // Contract field: spreadsheet display name — one metadata call per
    // poll-with-events (not per row); failure degrades to null, never blocks.
    let spreadsheetName: string | null = null;
    try {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId: trigger.spreadsheetId,
        fields: 'properties.title',
      });
      spreadsheetName = meta.data.properties?.title || null;
    } catch {
      spreadsheetName = null;
    }

    // Create ZapRun for each fired row
    for (const row of fireRows) {
      const metadata = {
        // Contract fields (spec §4)
        spreadsheetId: trigger.spreadsheetId,
        spreadsheetName,
        sheetName: trigger.sheetName,
        rowNumber: row.row_number,
        rowData: row.row_data,
        rowArray: row.row_array,
        event: row.event,
        timestamp: new Date().toISOString(),
        // Legacy aliases — existing zaps template against these
        row_number: row.row_number,
        row_data: row.row_data,
      };
      await this.createZapRun(trigger.zapId, metadata, {
        scope: 'sheets',
        key: `${trigger.zapId}:sheets:${row.row_number}:${row.event}:${row.rowHash}`,
      });
    }

    // Update last polled timestamp
    await client.googleSheetsTrigger.update({
      where: { id: trigger.id },
      data: { lastPolledAt: new Date() },
    });

    return fireRows.length;
  }
}
