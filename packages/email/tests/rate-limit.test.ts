/**
 * #57 — the email rate limiter used one platform-wide key (`email:rate_limit`,
 * 10/hour) and one platform-wide recipient cooldown, so ten sends from a single
 * account refused email for every other tenant for an hour.
 *
 * The Redis module is replaced with an in-memory fake that mimics the subset
 * the limiter uses (get/ttl/exists/incr/set with EX), so the bucketing decisions
 * are exercised for real rather than mocked away.
 */

const store = new Map<string, { value: string; expiresAt: number | null }>();

const redisFake = {
  get: jest.fn(async (key: string) => store.get(key)?.value ?? null),
  ttl: jest.fn(async (key: string) => {
    const entry = store.get(key);
    if (!entry || entry.expiresAt === null) return -1;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }),
  exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
  incr: jest.fn(async (key: string) => {
    const entry = store.get(key);
    const next = (entry ? parseInt(entry.value) : 0) + 1;
    store.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null });
    return next;
  }),
  set: jest.fn(async (key: string, value: string, opts?: { ex?: number }) => {
    store.set(key, {
      value,
      expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
    });
    return 'OK';
  }),
  del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
};

jest.mock('@repo/redis', () => ({ __esModule: true, default: redisFake }), { virtual: true });

const sendMock = jest.fn();
jest.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: any[]) => sendMock(...args) };
  },
}));

import { getRateLimitStatus, sendEmailWithTextBody } from '../src/index';

const scopeA = { userId: 'tenant-a' };
const scopeB = { userId: 'tenant-b' };

beforeEach(() => {
  store.clear();
  sendMock.mockReset();
  sendMock.mockResolvedValue({ data: { id: 'resend-id' }, error: null });
});

describe('email rate limiting is scoped per tenant', () => {
  it('lets tenant B send after tenant A exhausts its own budget', async () => {
    // Default tenant budget is 10/hour.
    for (let i = 0; i < 10; i++) {
      const res = await sendEmailWithTextBody(`a${i}@a.example`, 's', 'b', scopeA);
      expect(res).toEqual({ id: 'resend-id' });
    }

    const blocked = await sendEmailWithTextBody('a-extra@a.example', 's', 'b', scopeA);
    expect(blocked).toMatchObject({ error: 'RATE_LIMITED', reason: 'TENANT' });

    // The old global key would have refused this one too.
    const other = await sendEmailWithTextBody('b0@b.example', 's', 'b', scopeB);
    expect(other).toEqual({ id: 'resend-id' });
  });

  it('keeps a separate bucket for sends with no tenant identity', async () => {
    for (let i = 0; i < 10; i++) {
      await sendEmailWithTextBody(`a${i}@a.example`, 's', 'b', scopeA);
    }
    // Auth mail carries a userId; anything unscoped shares the anonymous bucket.
    const anonymous = await sendEmailWithTextBody('new@user.example', 's', 'b');
    expect(anonymous).toEqual({ id: 'resend-id' });
  });

  it('keeps the recipient cooldown per sender, so two Zaps can share one inbox', async () => {
    const first = await sendEmailWithTextBody('ops@shared.example', 's', 'b', scopeA);
    expect(first).toEqual({ id: 'resend-id' });

    // Same recipient, same sender, immediately: still cooled down.
    const again = await sendEmailWithTextBody('ops@shared.example', 's', 'b', scopeA);
    expect(again).toMatchObject({ error: 'RECIPIENT_COOLDOWN' });

    // Same recipient, different sender: allowed.
    const other = await sendEmailWithTextBody('ops@shared.example', 's', 'b', scopeB);
    expect(other).toEqual({ id: 'resend-id' });
  });

  it('reports the remaining budget for the caller scope', async () => {
    await sendEmailWithTextBody('a0@a.example', 's', 'b', scopeA);

    const a = await getRateLimitStatus(scopeA);
    const b = await getRateLimitStatus(scopeB);
    expect(a.remaining).toBe(8); // 10 - 1 sent - 1 for the send in flight
    expect(b.remaining).toBe(9);
  });

  it('still refuses every tenant once the provider ceiling is reached', async () => {
    // Shrink the provider ceiling for this test only.
    process.env.EMAIL_PLATFORM_RATE_LIMIT_PER_HOUR = '1';
    jest.resetModules();

    const { sendEmailWithTextBody: send } = require('../src/index');
    const first = await send('a0@a.example', 's', 'b', scopeA);
    expect(first).toEqual({ id: 'resend-id' });

    const second = await send('b0@b.example', 's', 'b', scopeB);
    expect(second).toMatchObject({ error: 'RATE_LIMITED', reason: 'PLATFORM' });

    delete process.env.EMAIL_PLATFORM_RATE_LIMIT_PER_HOUR;
    jest.resetModules();
  });
});

describe('send results are always explicit', () => {
  it('reports a missing template instead of returning undefined', async () => {
    const result = await sendEmailWithTextBody('a@b.example', 's', 'b', scopeA);
    expect(result).toEqual({ id: 'resend-id' });

    const { sendEmail } = require('../src/index');
    // Fresh recipient: the send above put a@b.example on cooldown.
    const missing = await sendEmail('fresh@b.example', 's', 'no-such-template.html', {}, scopeA);
    // Used to be `return;` — indistinguishable from success to every caller.
    expect(missing).toEqual({ error: 'TEMPLATE_NOT_FOUND', template: 'no-such-template.html' });
  });

  it('reports provider errors instead of returning undefined', async () => {
    sendMock.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } });

    const result = await sendEmailWithTextBody('c@d.example', 's', 'b', scopeB);
    expect(result).toEqual({ error: 'domain not verified' });
  });
});
