import { GoogleSheetsPoller } from '../src/pollers/GoogleSheetsPoller';
import client from '@repo/db';
import redis from '@repo/redis';
import { enqueueRun } from '@repo/runs';

const mockValuesGet = jest.fn();
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
          zap: true,
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
      (redis.hget as jest.Mock).mockResolvedValue(null);

      const result = await poller.poll();

      // Verify ZapRun enqueues for both rows with correct domain structure
      expect(enqueueRun).toHaveBeenCalledTimes(2);
      expect(enqueueRun).toHaveBeenNthCalledWith(1, {
        zapId: 'zap-1',
        metadata: {
          row_number: 2,
          row_data: {
            Name: 'Alice',
            Email: 'alice@example.com',
            Amount: '100',
          },
        },
        source: 'google-sheets.poll',
      });
      expect(enqueueRun).toHaveBeenNthCalledWith(2, {
        zapId: 'zap-1',
        metadata: {
          row_number: 3,
          row_data: {
            Name: 'Bob',
            Email: 'bob@example.com',
            Amount: '',
          },
        },
        source: 'google-sheets.poll',
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
      (redis.hget as jest.Mock).mockResolvedValue(existingHash);

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
      (redis.hget as jest.Mock).mockResolvedValue(oldHash);

      const result = await poller.poll();

      expect(enqueueRun).toHaveBeenCalledTimes(1);
      expect(enqueueRun).toHaveBeenCalledWith({
        zapId: 'zap-1',
        metadata: {
          row_number: 2,
          row_data: {
            Name: 'Alice',
            Email: 'alice.new@example.com',
          },
        },
        source: 'google-sheets.poll',
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
