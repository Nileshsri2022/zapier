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

jest.mock('../src/utils/retry', () => ({
  withRetry: (fn: any) => fn(),
}));

jest.mock('@repo/email', () => ({
  sendEmailWithTextBody: jest.fn(),
  sendZapFailureNotification: jest.fn(),
}));

import { markRunFailed, processMessage } from '../src/index';

const kafkaMessage = (payload: any) => ({
  value: Buffer.from(JSON.stringify(payload)),
  offset: '5',
});

describe('worker run lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('rejects when the ZapRun no longer exists', async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(processMessage(kafkaMessage({ zapRunId: 'missing', stage: 1 }))).rejects.toThrow(
      /does not exist/
    );
  });

  it('marks the run failed (instead of leaving it running) when the action is missing', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'run-1',
      status: 'pending',
      metadata: {},
      zap: { id: 'zap-1', actions: [], user: { email: 'a@b.com' } },
    });

    const result = await processMessage(kafkaMessage({ zapRunId: 'run-1', stage: 1 }));

    expect(result).toEqual(
      expect.objectContaining({ success: false, reason: 'action_not_found' })
    );
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'run-1', status: { in: ['pending', 'running'] } },
        data: expect.objectContaining({ status: 'failed' }),
      })
    );
  });

  it('markRunFailed is a no-op for an absent run id', async () => {
    await markRunFailed(undefined, 'boom');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
