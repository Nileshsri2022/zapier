import client from '@repo/db';
import redis from '@repo/redis';

/**
 * T7 polling fallback (Q-TG-T-02) + offset discipline (Q-TG-T-05):
 * only webhook-less bots are polled; the offset advances only after the
 * whole batch processes cleanly; 401/429/409 are classified.
 */

const mockProcessMessage = jest.fn();
jest.mock('../src/telegramHandler', () => ({
  ...jest.requireActual('../src/telegramHandler'),
  processMessage: (...args: any[]) => mockProcessMessage(...args),
}));

import { pollTelegramBots } from '../src/telegramPoll';

const mockFindMany = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();

// The global setup mocks @repo/db + @repo/redis; wire our local spies.
(client.telegramBot as any).findMany = (...a: any[]) => mockFindMany(...a);
(redis.get as any) = (...a: any[]) => mockRedisGet(...a);
(redis.set as any) = (...a: any[]) => mockRedisSet(...a);

const jsonResponse = (status: number, body: any, headers: Record<string, string> = {}) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
  }) as any;

const bot = { id: 'bot-1', botName: 'Helper', botToken: 'tok-123', webhookConfigured: false };
const mkUpdate = (id: number, text = 'hi') => ({
  update_id: id,
  message: {
    message_id: id * 10,
    from: { id: 1, first_name: 'Ada', is_bot: false },
    chat: { id: 5, type: 'private' },
    date: 1_700_000_000,
    text,
  },
});

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([bot]);
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockProcessMessage.mockResolvedValue(undefined);
  mockFetch.mockResolvedValue(
    jsonResponse(200, { ok: true, result: [mkUpdate(100), mkUpdate(101)] })
  );
});

describe('pollTelegramBots', () => {
  it('polls only bots without a webhook and dispatches each message update', async () => {
    const result = await pollTelegramBots();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { isActive: true, webhookConfigured: false },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/getUpdates?offset=0&timeout=0'),
      { method: 'GET' }
    );
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
    expect(result.updatesProcessed).toBe(2);
    // Whole batch clean → offset = max(update_id)+1
    expect(mockRedisSet).toHaveBeenCalledWith('telegram:offset:bot-1', 102);
  });

  it('holds the offset when any update fails (at-least-once redelivery)', async () => {
    mockProcessMessage.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('db down'));

    const result = await pollTelegramBots();

    expect(result.errors).toBe(1);
    expect(mockRedisSet).not.toHaveBeenCalled(); // offset untouched → redelivery
  });

  it('duplicate-safe: offset advance means already-processed ids never re-run', async () => {
    mockRedisGet.mockResolvedValue(102); // already advanced past both
    await pollTelegramBots();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('offset=102'),
      expect.anything()
    );
    // Fresh batch (id > stored) still works:
    expect(mockProcessMessage).toHaveBeenCalledTimes(2);
  });

  it('429 rate limit → classified, offset held, no dispatch', async () => {
    mockFetch.mockResolvedValue(jsonResponse(429, {}, { 'retry-after': '30' }));
    const result = await pollTelegramBots();

    expect(result.errors).toBe(1);
    expect(mockProcessMessage).not.toHaveBeenCalled();
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('401 invalid token → auth-class error, bot skipped', async () => {
    mockFetch.mockResolvedValue(jsonResponse(401, { ok: false }));
    const result = await pollTelegramBots();
    expect(result.errors).toBe(1);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('409 webhook conflict → skip without error count (webhook owns delivery)', async () => {
    mockFetch.mockResolvedValue(jsonResponse(409, { ok: false }));
    const result = await pollTelegramBots();
    expect(result.botsPolled).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('API-level retry_after (ok:false with parameters) → offset held', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 17 },
      })
    );
    const result = await pollTelegramBots();
    expect(result.errors).toBe(1);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });
});
