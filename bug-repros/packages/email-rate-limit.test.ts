/**
 * BUG: the email rate limit is a single platform-wide counter.
 *
 * packages/email/src/index.ts:15-20:
 *   const RATE_LIMIT_KEY = 'email:rate_limit';                       // one global key
 *   const MAX_EMAILS_PER_HOUR = parseInt(… || '10');                 // 10/hour TOTAL
 *   const RECIPIENT_COOLDOWN_SECONDS = parseInt(… || '300');         // 5 min per recipient
 *
 * Every sender shares that bucket: signup confirmations
 * (apps/server/src/controllers/AuthController.ts:56) and every tenant's Email
 * action (apps/worker/src/index.ts:103 → sendEmailWithTextBody). So the 11th
 * email in an hour is refused for EVERYONE — user B's Zap fails with
 * `{ error: 'RATE_LIMITED' }` because user A's Zap already sent ten, and the
 * worker turns that into a failed ZapRun (index.ts:107-110). The per-recipient
 * cooldown has the same problem: two unrelated Zaps notifying the same address
 * (a shared ops inbox) lose the second message for 5 minutes.
 *
 * Expected (green): limits are scoped per user/Zap (and per-recipient cooldowns
 * per sender), so one tenant's volume cannot block another tenant's email.
 */
const resendSend = jest.fn();

jest.mock('resend', () => ({
  Resend: class {
    emails = { send: (...args: any[]) => resendSend(...args) };
  },
}));

jest.mock('@repo/redis', () => {
  const store = new Map<string, { value: string; expiresAt: number | null }>();
  const now = () => Date.now();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry;
  };
  const redis = {
    __store: store,
    get: jest.fn(async (key: string) => live(key)?.value ?? null),
    set: jest.fn(async (key: string, value: string, opts?: { ex?: number }) => {
      store.set(key, { value, expiresAt: opts?.ex ? now() + opts.ex * 1000 : null });
      return 'OK';
    }),
    incr: jest.fn(async (key: string) => {
      const entry = live(key) ?? { value: '0', expiresAt: null };
      const next = parseInt(entry.value, 10) + 1;
      store.set(key, { value: String(next), expiresAt: entry.expiresAt });
      return next;
    }),
    exists: jest.fn(async (key: string) => (live(key) ? 1 : 0)),
    ttl: jest.fn(async (key: string) => {
      const entry = live(key);
      if (!entry) return -2;
      if (entry.expiresAt === null) return -1;
      return Math.ceil((entry.expiresAt - now()) / 1000);
    }),
  };
  return { __esModule: true, default: redis, redis };
});

import redis from '@repo/redis';
import { sendEmailWithTextBody } from '../../packages/email/src/index';

beforeEach(() => {
  jest.clearAllMocks();
  (redis as any).__store.clear();
  resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null });
});

describe('email rate limiting scope', () => {
  it('does not let one tenant exhaust the platform budget for everybody else', async () => {
    // Tenant A's Zap sends 10 emails (the default hourly budget) …
    for (let i = 0; i < 10; i++) {
      await sendEmailWithTextBody(`tenant-a+${i}@acme.io`, 'A', 'body');
    }

    // … tenant B's Zap (a different user, different recipient) must still send.
    const result: any = await sendEmailWithTextBody(
      'tenant-b@othercorp.io',
      'B',
      'body'
    );

    expect(result?.error).toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(11);
  });

  it('lets two unrelated Zaps notify the same shared inbox inside 5 minutes', async () => {
    const first: any = await sendEmailWithTextBody('ops@shared.io', 'Zap 1', 'one');
    expect(first?.error).toBeUndefined();

    const second: any = await sendEmailWithTextBody('ops@shared.io', 'Zap 2', 'two');

    // Today: { error: 'RECIPIENT_COOLDOWN', cooldownRemaining: 300 }
    expect(second?.error).toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(2);
  });
});
