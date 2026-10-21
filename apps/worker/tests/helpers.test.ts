import { evaluateFilters } from '../src/evaluateFilters';
import { withRetry, isRetryableError } from '../src/utils/retry';

/**
 * Smoke tests for the worker's pure helpers.
 * These are the cheapest tests in the repo (no infra needed) and they cover
 * the paths where a wrong answer is silent rather than loud.
 */

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('evaluateFilters', () => {
  const payload = { amount: 25, from: 'billing@acme.com', subject: 'Invoice #42' };

  it('passes everything when there are no conditions', () => {
    expect(evaluateFilters([], payload)).toBe(true);
  });

  it('matches equality', () => {
    expect(
      evaluateFilters([{ field: 'from', operator: 'equals', value: 'billing@acme.com' }], payload)
    ).toBe(true);
    expect(
      evaluateFilters([{ field: 'from', operator: 'equals', value: 'other@acme.com' }], payload)
    ).toBe(false);
  });

  it('matches "contains" case-insensitively', () => {
    expect(
      evaluateFilters([{ field: 'subject', operator: 'contains', value: 'invoice' }], payload)
    ).toBe(true);
  });

  it('compares numbers, not strings', () => {
    expect(
      evaluateFilters([{ field: 'amount', operator: 'greater_than', value: 10 }], payload)
    ).toBe(true);
    expect(
      evaluateFilters([{ field: 'amount', operator: 'greater_than', value: 100 }], payload)
    ).toBe(false);
  });

  it('supports nested field paths', () => {
    expect(
      evaluateFilters([{ field: 'data.user', operator: 'equals', value: 'john' }], {
        data: { user: 'john' },
      })
    ).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns the value on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 1 });

    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('recovered');
    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 1 });

    expect(result.success).toBe(true);
    expect(result.data).toBe('recovered');
    expect(result.attempts).toBe(2);
  });

  it('gives up after maxRetries and reports the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    const result = await withRetry(fn, { maxRetries: 3, initialDelayMs: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('boom');
    expect(result.attempts).toBe(3);
  });
});

describe('isRetryableError', () => {
  it('treats transient network failures as retryable', () => {
    expect(isRetryableError(new Error('connect ETIMEDOUT 1.2.3.4:443'))).toBe(true);
    expect(isRetryableError(new Error('429 Too Many Requests'))).toBe(true);
  });

  it('treats validation failures as not retryable', () => {
    expect(isRetryableError(new Error('Invalid email address'))).toBe(false);
  });
});
