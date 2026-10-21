import { ACTION_CATALOG, acceptedActionTypes, offeredActionTypes } from '@repo/actions';
import { EmailActionError } from '../src/sendEmail';
import {
  EXECUTORS,
  RETRY_POLICIES,
  executeActionWithRetry,
  resolveAction,
  unknownActionError,
} from '../src/actionRegistry';

/**
 * The registry is the worker's answer to "which actions can I run?". These
 * tests prove it covers the shared catalog in both directions — no catalog
 * entry without an executor, no executor without a catalog entry — and that the
 * guard rejects unknown, mistyped and prefix-shaped types before any retry.
 */

describe('catalog ↔ executor coverage', () => {
  it('has an executor for every catalog entry', () => {
    for (const entry of ACTION_CATALOG) {
      expect(EXECUTORS[entry.executorKey]).toBeDefined();
      expect(resolveAction(entry.type)?.executor).toBe(EXECUTORS[entry.executorKey]);
    }
  });

  it('has no executor the catalog cannot reach', () => {
    const reachable = new Set(ACTION_CATALOG.map((entry) => entry.executorKey));
    expect(Object.keys(EXECUTORS).sort()).toEqual(Array.from(reachable).sort());
  });

  it('offers exactly the canonical types the seed writes', () => {
    for (const type of offeredActionTypes()) {
      expect(resolveAction(type)).toBeDefined();
    }
  });
});

describe('retry policies', () => {
  it('declares exactly three policies', () => {
    expect(Object.keys(RETRY_POLICIES).sort()).toEqual(['action', 'email', 'none']);
  });

  it('lets the webhook run once — the receiver owns idempotency (A4)', () => {
    expect(EXECUTORS.webhook.policy).toBe('none');
    expect(RETRY_POLICIES.none.maxRetries).toBe(1);
  });

  it('classifies email failures as retryable only when the error says so', () => {
    expect(EXECUTORS.email.policy).toBe('email');
    const shouldRetry = RETRY_POLICIES.email.shouldRetry as (error: Error) => boolean;

    expect(shouldRetry(new EmailActionError('provider hiccup', 'provider', true))).toBe(true);
    expect(shouldRetry(new EmailActionError('bad from address', 'from_not_allowed', false))).toBe(
      false
    );
    expect(shouldRetry(new Error('unclassified'))).toBe(false);
  });

  it('leaves retries to the AI executor, whose step loop has its own budget', () => {
    expect(EXECUTORS.ai.policy).toBeUndefined();
  });

  it('applies the default policy to the remaining executors', () => {
    for (const key of ['solana', 'whatsapp', 'telegram', 'discord'] as const) {
      expect(EXECUTORS[key].policy).toBe('action');
      expect(RETRY_POLICIES.action.maxRetries).toBe(3);
    }
  });
});

describe('unknown action types', () => {
  it.each([
    'WhatsApp Sendd', // typo
    'WhatsApp Anything', // old prefix behaviour accepted this
    'Telegram Sendd',
    'Gmail Send Email',
    'Discord Alert',
    'email',
    '',
  ])('refuses %s immediately, without retrying', async (actionType) => {
    const result = await executeActionWithRetry(actionType, {}, {});

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
    expect((result.error as Error).message).toContain('Known types:');
  });

  it('lists the accepted types so the fix is one line', () => {
    const message = unknownActionError('WhatsApp Sendd').message;
    for (const type of acceptedActionTypes()) {
      expect(message).toContain(type);
    }
  });

  it('still resolves the bare legacy names a Zap may already hold', () => {
    expect(resolveAction('WhatsApp')?.executor).toBe(EXECUTORS.whatsapp);
    expect(resolveAction('Telegram')?.executor).toBe(EXECUTORS.telegram);
  });
});
