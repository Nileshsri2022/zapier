/**
 * BUG: a Google Sheets trigger created through the editor fires a ZapRun for
 * EVERY pre-existing row on its first poll.
 *
 * apps/processor/src/pollers/GoogleSheetsPoller.ts:132-148 treats a row with no
 * stored hash as new (`isNewRow = !oldHash`) and enqueues a run for it. Nothing
 * seeds those hashes for editor-created Zaps:
 * `apps/server/src/controllers/ZapController.ts:67-75` creates the
 * `googleSheetsTrigger` row without initialising the Redis hash set, while the
 * dedicated endpoint does seed it
 * (`GoogleSheetsTriggersController.ts:87-94` → `service.pollForUpdates`).
 * The editor always uses `POST /api/zaps` (createZap), so publishing a
 * "Google Sheets Updated Row" Zap against a sheet with N existing rows enqueues
 * N runs within one poll interval — N emails/WhatsApp messages/SOL transfers.
 * The Redis key also expires after 30 days (:155), so the storm repeats monthly.
 *
 * Note the server's own implementation has the opposite semantics
 * (`GoogleSheetsService.pollForUpdates` only fires when `oldHash && oldHash !== newHash`),
 * so the two pollers disagree about what "first poll" means.
 *
 * Expected (green): the first poll for a trigger with no stored hashes records a
 * baseline and enqueues nothing; only rows added afterwards fire.
 */
const valuesGet = jest.fn();
const enqueueRun = jest.fn();

jest.mock('googleapis', () => {
  class FakeOAuth2 {
    credentials: any = {};
    setCredentials(creds: any) {
      this.credentials = creds;
    }
    async refreshAccessToken() {
      return { credentials: { access_token: 'fresh', expiry_date: Date.now() + 3_600_000 } };
    }
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      sheets: () => ({ spreadsheets: { values: { get: (...a: any[]) => valuesGet(...a) } } }),
    },
  };
});

jest.mock('@repo/redis', () => {
  const store = new Map<string, Map<string, string>>();
  const hash = (key: string) => {
    if (!store.has(key)) store.set(key, new Map());
    return store.get(key)!;
  };
  const redis = {
    __store: store,
    hget: jest.fn(async (key: string, field: string) => hash(key).get(field) ?? null),
    hset: jest.fn(async (key: string, fields: Record<string, string>) => {
      for (const [f, v] of Object.entries(fields)) hash(key).set(f, v);
      return Object.keys(fields).length;
    }),
    expire: jest.fn(async () => 1),
  };
  return { __esModule: true, default: redis, redis };
});

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    googleSheetsTrigger: { findMany: jest.fn(), update: jest.fn() },
    googleSheetsServer: { update: jest.fn() },
  },
}));

jest.mock('@repo/runs', () => ({
  __esModule: true,
  enqueueRun: (...args: any[]) => enqueueRun(...args),
}));

import client from '@repo/db';
import redis from '@repo/redis';
import { GoogleSheetsPoller } from '../../apps/processor/src/pollers/GoogleSheetsPoller';

const TRIGGER_ID = 'sheets-trigger-1';
const trigger = {
  id: TRIGGER_ID,
  zapId: 'zap-1',
  spreadsheetId: 'sheet-1',
  sheetName: 'Leads',
  isActive: true,
  server: {
    id: 'server-1',
    accessToken: 'token',
    refreshToken: 'refresh',
    tokenExpiry: new Date(Date.now() + 3_600_000),
  },
  zap: { id: 'zap-1', isActive: true },
};

/** Sheet contents: header row + data rows. */
let rows: any[][] = [];

const setSheet = (dataRows: any[][]) => {
  rows = [['Name', 'Email'], ...dataRows];
};

beforeEach(() => {
  jest.clearAllMocks();
  (redis as any).__store.clear();
  (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([trigger]);
  (client.googleSheetsTrigger.update as jest.Mock).mockResolvedValue({});
  valuesGet.mockImplementation(async () => ({ data: { values: rows } }));
  enqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
});

const poll = () => new GoogleSheetsPoller().poll();

describe('GoogleSheetsPoller first-poll baseline', () => {
  it('does not fire runs for rows that existed before the trigger was created', async () => {
    // Exactly what a user sees after publishing a Sheets Zap from the editor:
    // the sheet already has data, the Redis hash set is empty.
    setSheet([
      ['Ada', 'ada@example.com'],
      ['Bob', 'bob@example.com'],
      ['Cid', 'cid@example.com'],
    ]);

    const result = await poll();

    expect(enqueueRun).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('fires exactly one run for a row appended after the baseline', async () => {
    setSheet([
      ['Ada', 'ada@example.com'],
      ['Bob', 'bob@example.com'],
    ]);
    await poll(); // baseline
    enqueueRun.mockClear();

    setSheet([
      ['Ada', 'ada@example.com'],
      ['Bob', 'bob@example.com'],
      ['Dee', 'dee@example.com'],
    ]);
    await poll();

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-1',
        metadata: expect.objectContaining({ row_number: 4 }),
      })
    );
  });

  it('fires for a pre-existing row that was edited after the baseline (control)', async () => {
    setSheet([['Ada', 'ada@example.com']]);
    await poll(); // baseline
    enqueueRun.mockClear();

    setSheet([['Ada', 'ada+updated@example.com']]);
    await poll();

    expect(enqueueRun).toHaveBeenCalledTimes(1);
  });
});
