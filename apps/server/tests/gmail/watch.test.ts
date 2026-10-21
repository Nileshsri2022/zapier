import client from '@repo/db';

/**
 * Gmail watch lifecycle (services/gmailWatch.ts): renewal and the polling
 * fallback. The Gmail client comes through the deps seam and the clock through
 * `deps.now`, so the renewal horizon is pinned without fake timers.
 */

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import {
  GMAIL_WATCH_RENEWAL_WINDOW_HOURS,
  GMAIL_WATCH_RENEWAL_WINDOW_MS,
  pollActiveGmailServers,
  renewExpiringGmailWatches,
} from '../../src/services/gmailWatch';

const fakeService = {
  getEmailMetadata: jest.fn(),
  getEmailContent: jest.fn(),
  getAttachments: jest.fn(),
  listHistory: jest.fn(),
  watchEmails: jest.fn(),
  getProfileEmail: jest.fn(),
};

const deps = (now?: Date) => ({
  createService: () => fakeService as any,
  ...(now ? { now: () => now } : {}),
});

const now = new Date('2026-10-19T00:00:00.000Z');
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 60 * 60 * 1000);

const server = {
  id: 'server-1',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  accessToken: 'access-token',
  tokenExpiry: null,
  email: 'owner@gmail.com',
  isActive: true,
};

const watchServer = (id: string, expiry: Date | null, extra: any = {}) => ({
  ...server,
  id,
  lastHistoryId: '100',
  watchHistory: expiry ? [{ expiry, isActive: true, createdAt: now }] : [],
  ...extra,
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
  fakeService.watchEmails.mockReset().mockResolvedValue({
    watchId: '555',
    expiry: new Date('2026-10-26T00:00:00.000Z'),
  });
  fakeService.getProfileEmail.mockReset();
  fakeService.listHistory.mockReset();
  fakeService.getEmailMetadata.mockReset().mockResolvedValue({
    id: 'msg-1',
    threadId: 't1',
    snippet: 's',
    from: 'A <a@example.com>',
    to: ['owner@gmail.com'],
    subject: 'Hello',
    date: new Date('2026-10-19T10:00:00.000Z'),
    labels: ['INBOX'],
    hasAttachments: false,
    isRead: false,
  });
  fakeService.getEmailContent.mockReset().mockResolvedValue({ body: 'body', truncated: false });
  (client.gmailWatch.create as jest.Mock).mockReset().mockResolvedValue({});
  (client.gmailServer.update as jest.Mock).mockReset().mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('renewExpiringGmailWatches', () => {
  it('names the renewal window instead of burying the magic number', () => {
    expect(GMAIL_WATCH_RENEWAL_WINDOW_HOURS).toBe(24);
    expect(GMAIL_WATCH_RENEWAL_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('renews only watches inside the window (or missing) and records them', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      watchServer('soon', hoursFromNow(12)),
      watchServer('fine', hoursFromNow(48)),
      watchServer('none', null, { lastHistoryId: null }),
    ]);

    const result = await renewExpiringGmailWatches(deps(now));

    expect(result).toEqual({ renewed: 2, failed: 0, checked: 3 });
    expect(fakeService.watchEmails).toHaveBeenCalledTimes(2);
    expect(client.gmailWatch.create).toHaveBeenCalledTimes(2);
    // Cursor initialized only where unset — never reset (would skip deltas).
    expect(client.gmailServer.update).toHaveBeenCalledTimes(1);
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'none' },
      data: { lastHistoryId: '555' },
    });
  });

  it('treats the window edge as due and anything past it as not', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      watchServer('edge', hoursFromNow(23)),
      watchServer('past', hoursFromNow(25)),
    ]);

    const result = await renewExpiringGmailWatches(deps(now));

    expect(result).toEqual({ renewed: 1, failed: 0, checked: 2 });
  });

  it('renews an inactive watch row even when its expiry is far away', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      {
        ...server,
        id: 'inactive',
        lastHistoryId: '100',
        watchHistory: [{ expiry: hoursFromNow(120), isActive: false, createdAt: now }],
      },
    ]);

    const result = await renewExpiringGmailWatches(deps(now));

    expect(result).toEqual({ renewed: 1, failed: 0, checked: 1 });
  });

  it('commits each renewal on its own: a later failure keeps the earlier row', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      watchServer('first', null),
      watchServer('second', null),
    ]);
    fakeService.watchEmails
      .mockResolvedValueOnce({ watchId: '111', expiry: hoursFromNow(160) })
      .mockRejectedValueOnce(new Error('watch rejected'));

    const result = await renewExpiringGmailWatches(deps(now));

    expect(result).toEqual({ renewed: 1, failed: 1, checked: 2 });
    // The first mailbox's row is already written; the second's failure only
    // counts as failed.
    expect(client.gmailWatch.create).toHaveBeenCalledTimes(1);
    expect(client.gmailWatch.create).toHaveBeenCalledWith({
      data: {
        serverId: 'first',
        watchId: '111',
        expiry: hoursFromNow(160),
        isActive: true,
      },
    });
  });
});

describe('pollActiveGmailServers (polling fallback)', () => {
  it('processes the delta only when the profile historyId advanced', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      { ...server, lastHistoryId: '100' },
    ]);
    fakeService.getProfileEmail.mockResolvedValue({ email: 'a@b.c', historyId: '200' });
    fakeService.listHistory.mockResolvedValue([]);

    const result = await pollActiveGmailServers(deps());

    expect(result.polled).toBe(1);
    expect(result.failedServers).toBe(0);
    expect(fakeService.listHistory).toHaveBeenCalledWith('100');
  });

  it('skips servers whose cursor already matches the profile', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      { ...server, lastHistoryId: '100' },
    ]);
    fakeService.getProfileEmail.mockResolvedValue({ email: 'a@b.c', historyId: '100' });

    const result = await pollActiveGmailServers(deps());

    expect(result.polled).toBe(0);
    expect(fakeService.listHistory).not.toHaveBeenCalled();
  });

  it('counts per-server failures without aborting the sweep', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      { ...server, id: 'bad', lastHistoryId: '1' },
      { ...server, id: 'good', lastHistoryId: '1' },
    ]);
    fakeService.getProfileEmail
      .mockRejectedValueOnce(new Error('profile down'))
      .mockResolvedValue({ email: 'a@b.c', historyId: '2' });
    fakeService.listHistory.mockResolvedValue([]);

    const result = await pollActiveGmailServers(deps());

    expect(result.failedServers).toBe(1);
    expect(result.polled).toBe(1);
  });
});
