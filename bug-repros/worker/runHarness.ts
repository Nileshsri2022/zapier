/**
 * Shared harness for driving `processMessage` with a single-action Zap.
 */
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateMany = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    zapRun: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      update: (...args: any[]) => mockUpdate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
    },
  },
}));

// Faithful RetryResult shape without the real backoff delays.
jest.mock('../../apps/worker/src/utils/retry', () => ({
  withRetry: async (fn: any) => {
    const startTime = Date.now();
    try {
      const data = await fn();
      return { success: true, data, attempts: 1, totalTimeMs: Date.now() - startTime };
    } catch (error: any) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        attempts: 1,
        totalTimeMs: Date.now() - startTime,
      };
    }
  },
}));

jest.mock('@repo/email', () => ({
  sendEmailWithTextBody: jest.fn(),
  sendZapFailureNotification: jest.fn(),
}));

import { sendEmailWithTextBody } from '@repo/email';
import { processMessage } from '../../apps/worker/src/index';

export const emailSend = sendEmailWithTextBody as unknown as jest.Mock;
export const zapRunUpdate = mockUpdate;

/** Run one stage-1 message through the worker with a single action. */
export async function runSingleAction(action: { type: string; metadata: any }, triggerData: any) {
  mockFindFirst.mockResolvedValue({
    id: 'run-1',
    status: 'pending',
    metadata: triggerData,
    zap: {
      id: 'zap-1',
      userId: 1,
      filterConditions: [],
      actions: [
        { sortingOrder: 1, stepConditions: [], metadata: action.metadata, action: { type: action.type } },
      ],
      user: { email: 'owner@example.com' },
    },
  });
  mockUpdate.mockResolvedValue({});
  mockUpdateMany.mockResolvedValue({ count: 1 });

  return processMessage({
    value: Buffer.from(JSON.stringify({ zapRunId: 'run-1', stage: 1 })),
    offset: '1',
  });
}

export { processMessage };
