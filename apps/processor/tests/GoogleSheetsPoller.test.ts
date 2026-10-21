import { GoogleSheetsPoller } from '../src/pollers/GoogleSheetsPoller';
import client from '@repo/db';
import redis from '@repo/redis';
import { enqueueRun } from '@repo/runs';

/** Field the poller stores in the row-hash hash to mark a baselined trigger. */
const BASELINE_FIELD = '__meta__';

/**
 * Pretend this trigger has already been baselined, so a poll is not the first
 * one. `hashFor(field)` supplies the stored row hash (null = unseen row).
 */
function seedBaseline(hashFor: (field: string) => string | null | undefined) {
  (redis.hget as jest.Mock).mockImplementation(async (_key: string, field: string) =>
    field === BASELINE_FIELD ? '1' : hashFor(field)
  );
}

const mockValuesGet = jest.fn();
const mockSpreadsheetGet = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        credentials: { expiry_date: Date.now() + 60 * 60 * 1000 },
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    sheets: jest.fn().mockImplementation(() => ({
      spreadsheets: {
        get: (...args: any[]) => mockSpreadsheetGet(...args),
        values: { get: (...args: any[]) => mockValuesGet(...args) },
      },
    })),
  },
}));

describe('GoogleSheetsPoller.poll - Seam 1', () => {
  let poller: GoogleSheetsPoller;

  const mockTrigger = {
    id: 'trigger-1',
    zapId: 'zap-1',
    spreadsheetId: 'sheet-123',
    sheetName: 'Sheet1',
    isActive: true,
    lastPolledAt: null,
    server: {
      id: 'server-1',
      refreshToken: 'mock-refresh-token',
      accessToken: 'mock-access-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
    zap: {
      id: 'zap-1',
      isActive: true,
    },
  };

  beforeEach(() => {
    poller = new GoogleSheetsPoller();
    jest.clearAllMocks();
    (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
  });

  describe('Slice 1: Active trigger querying and empty trigger handling', () => {
    it('queries active triggers with active zaps and returns zero processed when none exist', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([]);

      const result = await poller.poll();

      expect(client.googleSheetsTrigger.findMany).toHaveBeenCalledWith({
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
      expect(result).toEqual({
        service: 'google-sheets',
        processed: 0,
        errors: 0,
        duration: expect.any(Number),
      });
    });
  });

  describe('Slice 2: Empty or header-only sheets', () => {
    it('returns 0 processed rows and skips run enqueueing when sheet has no rows', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([mockTrigger]);
      mockValuesGet.mockResolvedValue({ data: { values: [] } });

      const result = await poller.poll();

      expect(mockValuesGet).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-123',
        range: "'Sheet1'!A:Z",
      });
      expect(enqueueRun).not.toHaveBeenCalled();
      expect(redis.hset).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('returns 0 processed rows when sheet only contains header row and no data rows', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([mockTrigger]);
      mockValuesGet.mockResolvedValue({ data: { values: [['Name', 'Email']] } });

      const result = await poller.poll();

      expect(enqueueRun).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('correctly quotes sheet names containing spaces and single quotes for Google Sheets A1 range notation', async () => {
      const complexNameTrigger = {
        ...mockTrigger,
        sheetName: "Alice & Bob's Ledger",
      };
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([complexNameTrigger]);
      mockValuesGet.mockResolvedValue({ data: { values: [] } });

      await poller.poll();

      expect(mockValuesGet).toHaveBeenCalledWith({
        spreadsheetId: 'sheet-123',
        range: "'Alice & Bob''s Ledger'!A:Z",
      });
    });
  });

  describe('Slice 3: New row detection & ZapRun intake', () => {
    it('detects new rows, maps headers into row_data, enqueues ZapRuns, and stores hashes in Redis with 30d TTL', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([mockTrigger]);
      mockValuesGet.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email', 'Amount'],
            ['Alice', 'alice@example.com', '100'],
            ['Bob', 'bob@example.com'], // missing 3rd column
          ],
        },
      });

      // Redis has no previous hashes for rows 2 and 3
      seedBaseline(() => null);

      const result = await poller.poll();

      // Verify ZapRun enqueues for both rows with correct domain structure
      // (grilled T2 contract: rowNumber/rowData/rowArray/event + legacy aliases)
      expect(enqueueRun).toHaveBeenCalledTimes(2);
      expect(enqueueRun).toHaveBeenNthCalledWith(1, {
        zapId: 'zap-1',
        metadata: {
          spreadsheetId: 'sheet-123',
          spreadsheetName: null,
          sheetName: 'Sheet1',
          rowNumber: 2,
          rowData: {
            Name: 'Alice',
            Email: 'alice@example.com',
            Amount: '100',
          },
          rowArray: ['Alice', 'alice@example.com', '100'],
          event: 'created',
          timestamp: expect.any(String),
          row_number: 2,
          row_data: {
            Name: 'Alice',
            Email: 'alice@example.com',
            Amount: '100',
          },
        },
        source: 'google-sheets.poll',
        dedup: { scope: 'sheets', key: expect.any(String) },
      });
      expect(enqueueRun).toHaveBeenNthCalledWith(2, {
        zapId: 'zap-1',
        metadata: {
          spreadsheetId: 'sheet-123',
          spreadsheetName: null,
          sheetName: 'Sheet1',
          rowNumber: 3,
          rowData: {
            Name: 'Bob',
            Email: 'bob@example.com',
            Amount: '',
          },
          rowArray: ['Bob', 'bob@example.com'],
          event: 'created',
          timestamp: expect.any(String),
          row_number: 3,
          row_data: {
            Name: 'Bob',
            Email: 'bob@example.com',
            Amount: '',
          },
        },
        source: 'google-sheets.poll',
        dedup: { scope: 'sheets', key: expect.any(String) },
      });

      // Verify Redis hash storage
      expect(redis.hset).toHaveBeenCalledWith(
        'sheets:trigger:trigger-1:rowhash',
        expect.objectContaining({
          '2': expect.any(String),
        })
      );
      expect(redis.hset).toHaveBeenCalledWith(
        'sheets:trigger:trigger-1:rowhash',
        expect.objectContaining({
          '3': expect.any(String),
        })
      );

      // Verify Redis TTL set to 30 days (60 * 60 * 24 * 30 = 2592000)
      expect(redis.expire).toHaveBeenCalledWith('sheets:trigger:trigger-1:rowhash', 2592000);

      // Verify lastPolledAt was updated
      expect(client.googleSheetsTrigger.update).toHaveBeenCalledWith({
        where: { id: 'trigger-1' },
        data: { lastPolledAt: expect.any(Date) },
      });

      expect(result).toEqual({
        service: 'google-sheets',
        processed: 2,
        errors: 0,
        duration: expect.any(Number),
      });
    });
  });

  describe('Slice 4: Unchanged row deduplication', () => {
    it('does not enqueue ZapRuns when row content matches existing Redis hash', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([mockTrigger]);
      mockValuesGet.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice@example.com'],
          ],
        },
      });

      // SHA-1 of 'Alice|alice@example.com'
      const existingHash = '7278631e07f3d371fd30eb51eab01304a4b46f59';
      seedBaseline(() => existingHash);

      const result = await poller.poll();

      expect(enqueueRun).not.toHaveBeenCalled();
      expect(result.processed).toBe(0);
      expect(result.errors).toBe(0);
      // Redis hash is refreshed/re-stored to ensure freshness
      expect(redis.hset).toHaveBeenCalledWith(
        'sheets:trigger:trigger-1:rowhash',
        expect.objectContaining({ '2': existingHash })
      );
    });
  });

  describe('Slice 5: Modified row detection', () => {
    it('detects in-place row edits, enqueues ZapRun with updated data, and writes new hash to Redis', async () => {
      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([mockTrigger]);
      mockValuesGet.mockResolvedValue({
        data: {
          values: [
            ['Name', 'Email'],
            ['Alice', 'alice.new@example.com'],
          ],
        },
      });

      // Old hash for previous version of row 2
      const oldHash = '7278631e07f3d371fd30eb51eab01304a4b46f59';
      seedBaseline(() => oldHash);

      const result = await poller.poll();

      expect(enqueueRun).toHaveBeenCalledTimes(1);
      expect(enqueueRun).toHaveBeenCalledWith({
        zapId: 'zap-1',
        metadata: {
          spreadsheetId: 'sheet-123',
          spreadsheetName: null,
          sheetName: 'Sheet1',
          rowNumber: 2,
          rowData: {
            Name: 'Alice',
            Email: 'alice.new@example.com',
          },
          rowArray: ['Alice', 'alice.new@example.com'],
          event: 'updated',
          timestamp: expect.any(String),
          row_number: 2,
          row_data: {
            Name: 'Alice',
            Email: 'alice.new@example.com',
          },
        },
        source: 'google-sheets.poll',
        dedup: { scope: 'sheets', key: expect.any(String) },
      });

      // New hash should be written to Redis
      const newExpectedHash = 'd76a596bb05697664654b9f0ff47ec069f201083'; // or expect.any(String) !== oldHash
      expect(redis.hset).toHaveBeenCalledWith(
        'sheets:trigger:trigger-1:rowhash',
        expect.objectContaining({ '2': expect.not.stringMatching(oldHash) })
      );

      expect(result.processed).toBe(1);
      expect(result.errors).toBe(0);
    });
  });

  describe('Slice 6: Token refresh & error isolation', () => {
    it('refreshes expired access token and updates googleSheetsServer before polling', async () => {
      const expiredTrigger = {
        ...mockTrigger,
        server: {
          ...mockTrigger.server,
          tokenExpiry: new Date(Date.now() - 5000), // expired 5 seconds ago
        },
      };

      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([expiredTrigger]);
      const newExpiry = Date.now() + 3600 * 1000;
      mockRefreshAccessToken.mockResolvedValue({
        credentials: {
          access_token: 'new-refreshed-token',
          expiry_date: newExpiry,
        },
      });
      mockValuesGet.mockResolvedValue({ data: { values: [] } });

      const result = await poller.poll();

      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(client.googleSheetsServer.update).toHaveBeenCalledWith({
        where: { id: 'server-1' },
        data: {
          accessToken: 'new-refreshed-token',
          tokenExpiry: new Date(newExpiry),
        },
      });
      expect(result.errors).toBe(0);
    });

    it('isolates errors and increments error count when a trigger fails (e.g., invalid_grant)', async () => {
      const failingTrigger = {
        ...mockTrigger,
        id: 'trigger-fail',
        server: {
          ...mockTrigger.server,
          tokenExpiry: new Date(Date.now() - 5000),
        },
      };

      (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([failingTrigger]);
      mockRefreshAccessToken.mockRejectedValue(
        new Error('invalid_grant: Token has been expired or revoked')
      );

      const result = await poller.poll();

      expect(result.errors).toBe(1);
      expect(result.processed).toBe(0);
      expect(enqueueRun).not.toHaveBeenCalled();
    });
  });
});

describe('GoogleSheetsPoller — T2 grilled spec (docs/ask-matt, round 4)', () => {
  let poller: GoogleSheetsPoller;

  const baseServer = {
    id: 'server-1',
    refreshToken: 'mock-refresh-token',
    accessToken: 'mock-access-token',
    tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
  };

  const triggerWithType = (type?: string) => ({
    id: 'trigger-1',
    zapId: 'zap-1',
    spreadsheetId: 'sheet-123',
    sheetName: 'Sheet1',
    isActive: true,
    lastPolledAt: null,
    server: baseServer,
    zap: {
      id: 'zap-1',
      isActive: true,
      ...(type ? { trigger: { trigger: { type } } } : {}),
    },
  });

  beforeEach(() => {
    poller = new GoogleSheetsPoller();
    jest.clearAllMocks();
    (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockSpreadsheetGet.mockResolvedValue({
      data: { properties: { title: 'Leads Q4' } },
    });
  });

  it('New Row mode: fires only on appends — an in-place edit just refreshes the hash', async () => {
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerWithType('Google Sheets New Row'),
    ]);
    mockValuesGet.mockResolvedValue({
      data: {
        values: [
          ['Name', 'Email'],
          ['Alice', 'alice@example.com'],
          ['Bob', 'bob@example.com'],
        ],
      },
    });
    // Row 2 exists (changed content), row 3 is brand new
    seedBaseline((rowKey) => (rowKey === '2' ? 'old-hash-for-row-2' : null));

    const result = await poller.poll();

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const call = (enqueueRun as jest.Mock).mock.calls[0][0];
    expect(call.metadata.event).toBe('created');
    expect(call.metadata.rowNumber).toBe(3);
    expect(result.processed).toBe(1);
    // Edited row still refreshes its hash (so it won't count as "new" later)
    expect(redis.hset).toHaveBeenCalledWith(
      'sheets:trigger:trigger-1:rowhash',
      expect.objectContaining({ '2': expect.any(String) })
    );
  });

  it('New Row mode: contract carries spreadsheetName, sheetName, rowArray and event', async () => {
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerWithType('Google Sheets New Row'),
    ]);
    mockValuesGet.mockResolvedValue({
      data: { values: [['Name'], ['Carol']] },
    });
    seedBaseline(() => null);

    await poller.poll();

    expect(mockSpreadsheetGet).toHaveBeenCalledWith({
      spreadsheetId: 'sheet-123',
      fields: 'properties.title',
    });
    expect(enqueueRun).toHaveBeenCalledTimes(1);
    const { metadata } = (enqueueRun as jest.Mock).mock.calls[0][0];
    expect(metadata).toMatchObject({
      spreadsheetId: 'sheet-123',
      spreadsheetName: 'Leads Q4',
      sheetName: 'Sheet1',
      rowNumber: 2,
      rowData: { Name: 'Carol' },
      rowArray: ['Carol'],
      event: 'created',
      row_number: 2,
      row_data: { Name: 'Carol' },
    });
    expect(typeof metadata.timestamp).toBe('string');
  });

  it('Headerless sheet: all-numeric first row is data with col_N keys + rowArray', async () => {
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerWithType('Google Sheets New Row'),
    ]);
    mockValuesGet.mockResolvedValue({
      data: {
        values: [
          ['101', '250'], // numeric first row = headerless data
          ['102', '300'],
        ],
      },
    });
    seedBaseline(() => null);

    const result = await poller.poll();

    expect(result.processed).toBe(2);
    expect(enqueueRun).toHaveBeenCalledTimes(2);
    const first = (enqueueRun as jest.Mock).mock.calls[0][0].metadata;
    expect(first.rowNumber).toBe(1);
    expect(first.rowData).toEqual({ col_1: '101', col_2: '250' });
    expect(first.rowArray).toEqual(['101', '250']);
    const second = (enqueueRun as jest.Mock).mock.calls[1][0].metadata;
    expect(second.rowNumber).toBe(2);
    expect(second.rowData).toEqual({ col_1: '102', col_2: '300' });
  });

  it('never fires fully-empty interior rows (they are not events)', async () => {
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerWithType('Google Sheets New Row'),
    ]);
    mockValuesGet.mockResolvedValue({
      data: {
        values: [
          ['Name'],
          ['Alice'],
          [], // empty interior row
          ['   '], // whitespace-only row
          ['Bob'],
        ],
      },
    });
    seedBaseline(() => null);

    const result = await poller.poll();

    expect(result.processed).toBe(2);
    expect(enqueueRun).toHaveBeenCalledTimes(2);
    const rows = (enqueueRun as jest.Mock).mock.calls.map((c: any[]) => c[0].metadata.rowNumber);
    expect(rows).toEqual([2, 5]);
  });

  it('legacy zaps without a recognized type keep new+updated behavior', async () => {
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerWithType(undefined),
    ]);
    mockValuesGet.mockResolvedValue({
      data: {
        values: [['Name'], ['Alice'], ['Bob']],
      },
    });
    seedBaseline((rowKey) => (rowKey === '2' ? 'old-hash-for-row-2' : null));

    const result = await poller.poll();

    expect(result.processed).toBe(2);
    const events = (enqueueRun as jest.Mock).mock.calls.map((c: any[]) => c[0].metadata.event);
    expect(events).toEqual(['updated', 'created']);
  });
});

/**
 * #47 — the poller used to `hset` each row's hash inside the read loop, before
 * the runs were enqueued. When intake failed, the row was already marked as
 * seen, so the retry that never happened was invisible and the row was lost
 * permanently. Hashes now land only after every run exists.
 */
describe('GoogleSheetsPoller — #47 hashes are persisted only after enqueue', () => {
  let poller: GoogleSheetsPoller;

  const trigger = {
    id: 'trigger-1',
    zapId: 'zap-1',
    spreadsheetId: 'sheet-123',
    sheetName: 'Sheet1',
    isActive: true,
    lastPolledAt: null,
    server: {
      id: 'server-1',
      refreshToken: 'mock-refresh-token',
      accessToken: 'mock-access-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
    zap: { id: 'zap-1', isActive: true },
  };

  beforeEach(() => {
    poller = new GoogleSheetsPoller();
    jest.clearAllMocks();
    mockSpreadsheetGet.mockResolvedValue({ data: { properties: { title: 'Leads Q4' } } });
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([trigger]);
    mockValuesGet.mockResolvedValue({
      data: { values: [['email'], ['first@example.com'], ['second@example.com']] },
    });
    seedBaseline(() => null);
  });

  it('leaves the hashes untouched when intake fails, so the next poll retries', async () => {
    (enqueueRun as jest.Mock).mockRejectedValue(new Error('kafka unavailable'));

    const result = await poller.poll();

    expect(result.errors).toBe(1);
    expect(result.processed).toBe(0);
    // The rows were never marked as seen.
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('writes one hash per fired row only after intake succeeds', async () => {
    (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });

    const result = await poller.poll();

    expect(result.processed).toBe(2);
    expect(redis.hset).toHaveBeenCalledTimes(1);
    const [key, updates] = (redis.hset as jest.Mock).mock.calls[0];
    expect(key).toBe('sheets:trigger:trigger-1:rowhash');
    expect(
      Object.keys(updates)
        .filter((k: string) => k !== BASELINE_FIELD)
        .sort()
    ).toEqual(['2', '3']);
    expect(updates[BASELINE_FIELD]).toBe('1');
    // The write happens after both runs exist.
    expect((enqueueRun as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('still persists hashes when a poll finds nothing to fire', async () => {
    // Same algorithm as GoogleSheetsPoller.hashRow: sha1 of '|'-joined cells.
    const hashOf = (values: string[]) =>
      require('crypto').createHash('sha1').update(values.join('|')).digest('hex');
    seedBaseline((rowKey) => {
      if (rowKey === '2') return hashOf(['first@example.com']);
      if (rowKey === '3') return hashOf(['second@example.com']);
      return null;
    });

    const result = await poller.poll();

    expect(result.processed).toBe(0);
    expect(redis.hset).toHaveBeenCalledTimes(1);
  });
});

/**
 * #46 — publishing a Sheets Zap used to fire one run for every row already in
 * the sheet, because "no stored hash" was read as "new row". The first poll is
 * now a baseline: it records what is there and fires nothing.
 */
describe('GoogleSheetsPoller — #46 first poll baselines the sheet', () => {
  let poller: GoogleSheetsPoller;

  const trigger = {
    id: 'trigger-1',
    zapId: 'zap-1',
    spreadsheetId: 'sheet-123',
    sheetName: 'Sheet1',
    isActive: true,
    lastPolledAt: null,
    server: {
      id: 'server-1',
      refreshToken: 'mock-refresh-token',
      accessToken: 'mock-access-token',
      tokenExpiry: new Date(Date.now() + 60 * 60 * 1000),
    },
    zap: { id: 'zap-1', isActive: true },
  };

  const sheetWith = (rows: string[][]) =>
    mockValuesGet.mockResolvedValue({ data: { values: rows } });

  beforeEach(() => {
    poller = new GoogleSheetsPoller();
    jest.clearAllMocks();
    (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([trigger]);
    (client.googleSheetsTrigger.update as jest.Mock).mockResolvedValue({});
    (enqueueRun as jest.Mock).mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockSpreadsheetGet.mockResolvedValue({ data: { properties: { title: 'Leads Q4' } } });
    // No stored hashes at all: a brand-new trigger.
    (redis.hget as jest.Mock).mockResolvedValue(null);
  });

  it('fires nothing for rows that existed before the Zap was published', async () => {
    sheetWith([['email'], ['a@example.com'], ['b@example.com'], ['c@example.com']]);

    const result = await poller.poll();

    expect(result.processed).toBe(0);
    expect(result.errors).toBe(0);
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it('records every existing row plus the baseline marker', async () => {
    sheetWith([['email'], ['a@example.com'], ['b@example.com']]);

    await poller.poll();

    const [, updates] = (redis.hset as jest.Mock).mock.calls[0];
    expect(Object.keys(updates).sort()).toEqual(['2', '3', BASELINE_FIELD]);
  });

  it('baselines an empty sheet too, so the first appended row still fires', async () => {
    sheetWith([['email']]);
    await poller.poll();

    // The marker makes the next poll a normal one.
    expect(Object.keys((redis.hset as jest.Mock).mock.calls[0][1])).toEqual([BASELINE_FIELD]);

    seedBaseline(() => null); // rows unseen, but baseline exists
    sheetWith([['email'], ['first@example.com']]);
    const second = await poller.poll();

    expect(second.processed).toBe(1);
    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });

  it('fires once for a row appended after the baseline', async () => {
    const crypto = require('crypto');
    const hashRow = (cells: string[]) =>
      crypto.createHash('sha1').update(cells.join('|')).digest('hex');

    seedBaseline((field) => (field === '2' ? hashRow(['a@example.com']) : null));
    sheetWith([['email'], ['a@example.com'], ['b@example.com']]);

    const result = await poller.poll();

    expect(result.processed).toBe(1);
    expect((enqueueRun as jest.Mock).mock.calls[0][0].metadata.rowNumber).toBe(3);
  });

  it('re-baselines instead of re-firing when the hash key expired after 30 idle days', async () => {
    // Expiry wipes the whole hash, marker included -> looks like a first poll.
    (redis.hget as jest.Mock).mockResolvedValue(null);
    sheetWith([['email'], ['a@example.com'], ['b@example.com']]);

    const result = await poller.poll();

    // The old behaviour was a storm of runs, once a month, for the whole sheet.
    expect(result.processed).toBe(0);
    expect(enqueueRun).not.toHaveBeenCalled();
  });
});
