const mockFindMany = jest.fn();
const mockZapFindFirst = jest.fn();
const mockEnqueueRun = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    telegramTrigger: { findMany: (...args: any[]) => mockFindMany(...args) },
    zap: { findFirst: (...args: any[]) => mockZapFindFirst(...args) },
  },
}));

jest.mock('@repo/runs', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

import { handleTelegramWebhook } from '../src/telegramHandler';

const update = {
  update_id: 1,
  message: {
    message_id: 42,
    from: { id: 7, first_name: 'Ada', is_bot: false },
    chat: { id: 99, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    text: 'hello',
  },
};

const call = async (params: Record<string, string>) => {
  const sendStatus = jest.fn();
  const res = { sendStatus, status: jest.fn().mockReturnValue({ json: jest.fn() }) };
  await handleTelegramWebhook({ body: update, params } as any, res as any);
  return { sendStatus };
};

describe('Telegram webhook bot scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([{ id: 't1', zapId: 'zap-1' }]);
    mockZapFindFirst.mockResolvedValue({ id: 'zap-1' });
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
  });

  it('only loads triggers for the bot that received the update', async () => {
    await call({ botId: 'bot-1' });

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bot: { id: 'bot-1', isActive: true },
        }),
      })
    );
    // The old query matched every tenant's bot.
    expect(mockFindMany.mock.calls[0][0].where.bot).not.toHaveProperty('isActive', undefined);

    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-1',
        source: 'hooks.telegram',
        dedup: { scope: 'telegram', key: 'bot-1:zap-1:42' },
      })
    );
  });

  it('does not dispatch when the webhook URL has no bot id', async () => {
    const { sendStatus } = await call({});

    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});
