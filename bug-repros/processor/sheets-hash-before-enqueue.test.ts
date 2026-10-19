/**
 * BUG: the Sheets poller persists row hashes BEFORE the runs are enqueued, so a
 * transient enqueue failure loses those rows permanently.
 *
 * apps/processor/src/pollers/GoogleSheetsPoller.ts:150-160 — the loop writes
 * every row's new hash to Redis (`redis.hset`) and only afterwards calls
 * `createZapRun(...)` for each collected row. If the run intake fails (Kafka
 * down, Postgres timeout, run-intake exception) the hash is already stored, so
 * the next poll sees `oldHash === newHash` and never fires: the update is
 * silently dropped with no retry and no error surfaced to the user.
 *
 * Expected (green): the hash for a row is committed only after its run was
 * successfully enqueued, so the row is retried on the next poll.
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

const trigger = {
  id: 'sheets-trigger-2',
  zapId: 'zap-2',
  spreadsheetId: 'sheet-2',
  sheetName: 'Orders',
  isActive: true,
  server: {
    id: 'server-2',
    accessToken: 'token',
    refreshToken: 'refresh',
    tokenExpiry: new Date(Date.now() + 3_600_000),
  },
  zap: { id: 'zap-2', isActive: true },
};

let rows: any[][] = [];

beforeEach(() => {
  jest.clearAllMocks();
  (redis as any).__store.clear();
  (client.googleSheetsTrigger.findMany as jest.Mock).mockResolvedValue([trigger]);
  (client.googleSheetsTrigger.update as jest.Mock).mockResolvedValue({});
  valuesGet.mockImplementation(async () => ({ data: { values: rows } }));
});

const poll = () => new GoogleSheetsPoller().poll();

describe('GoogleSheetsPoller hash persistence ordering', () => {
  it('retries a row whose run could not be enqueued', async () => {
    // Baseline: one existing row, intake healthy.
    rows = [
      ['Order', 'Total'],
      ['A-1', '10'],
    ];
    enqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-baseline' });
    await poll();
    enqueueRun.mockClear();

    // A new row arrives while the run intake is down.
    rows = [
      ['Order', 'Total'],
      ['A-1', '10'],
      ['A-2', '20'],
    ];
    enqueueRun.mockRejectedValue(new Error('kafka broker not available'));
    await poll();
    expect(enqueueRun).toHaveBeenCalledTimes(1); // the attempt that failed

    // Intake recovers; the sheet is unchanged. The dropped row must be retried.
    enqueueRun.mockClear();
    enqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-retry' });
    await poll();

    expect(enqueueRun).toHaveBeenCalledTimes(1);
    expect(enqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-2',
        metadata: expect.objectContaining({ row_number: 3 }),
      })
    );
  });
});
