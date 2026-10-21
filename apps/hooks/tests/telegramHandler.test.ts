const mockFindMany = jest.fn();
const mockZapFindFirst = jest.fn();
const mockEnqueueRun = jest.fn();
const mockTriggerUpdate = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    telegramTrigger: {
      findMany: (...args: any[]) => mockFindMany(...args),
      update: (...args: any[]) => mockTriggerUpdate(...args),
    },
    zap: { findFirst: (...args: any[]) => mockZapFindFirst(...args) },
  },
}));

jest.mock('@repo/runs', () => ({
  enqueueRun: (...args: any[]) => mockEnqueueRun(...args),
}));

import {
  handleTelegramWebhook,
  buildTelegramRunPayload,
  matchesChatTypeFilter,
} from '../src/telegramHandler';

/**
 * T7 fixtures (docs/ask-matt/triggers/telegram.md round 9): contract,
 * chat-type filter, update_id dedupe, media metadata, secret token,
 * messages-only consumption.
 */

const baseUpdate = {
  update_id: 1,
  message: {
    message_id: 42,
    from: { id: 7, first_name: 'Ada', last_name: 'L', username: 'ada', is_bot: false },
    chat: { id: 99, type: 'private', first_name: 'Ada' },
    date: 1_700_000_000,
    text: 'hello',
  },
};

/**
 * Deliver one update. Telegram is fail-closed now (Q10/@repo/ingress), so a
 * configured secret is presented by default and a test opts out by passing its
 * own `x-telegram-bot-api-secret-token`.
 */
const call = async (
  params: Record<string, string>,
  body: any = baseUpdate,
  headers: Record<string, string> = {}
) => {
  const delivered = { ...headers };
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && !('x-telegram-bot-api-secret-token' in delivered)) {
    delivered['x-telegram-bot-api-secret-token'] = secret;
  }
  const sendStatus = jest.fn();
  const json = jest.fn();
  const res = { sendStatus, status: jest.fn().mockReturnValue({ json }), json };
  await handleTelegramWebhook({ body, params, headers: delivered } as any, res as any);
  return { sendStatus, json, res };
};

describe('Telegram webhook bot scoping', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
    mockFindMany.mockResolvedValue([{ id: 't1', zapId: 'zap-1' }]);
    mockZapFindFirst.mockResolvedValue({ id: 'zap-1', name: 'TG Zap' });
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockTriggerUpdate.mockResolvedValue({});
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
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
  });

  it('dedupes on update_id (Q-TG-T-05) with the bot+zap scoped key', async () => {
    await call({ botId: 'bot-1' });

    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({
        zapId: 'zap-1',
        source: 'hooks.telegram',
        dedup: { scope: 'telegram', key: 'bot-1:zap-1:1' },
      })
    );
  });

  it('redelivery of the same update_id → duplicate acked 200, trigger clock untouched', async () => {
    mockEnqueueRun.mockResolvedValue({ status: 'duplicate' });
    const { sendStatus } = await call({ botId: 'bot-1' });

    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mockTriggerUpdate).not.toHaveBeenCalled();
  });

  it('does not dispatch when the webhook URL has no bot id', async () => {
    const { sendStatus } = await call({});

    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});

describe('T7 contract (§4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
    mockFindMany.mockResolvedValue([{ id: 't1', zapId: 'zap-1' }]);
    mockZapFindFirst.mockResolvedValue({ id: 'zap-1', name: 'TG Zap' });
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockTriggerUpdate.mockResolvedValue({});
  });

  it('text message populates contract fields + legacy aliases', async () => {
    await call({ botId: 'bot-1' });

    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata).toMatchObject({
      updateId: 1,
      messageId: 42,
      chat: { id: 99, type: 'private', title: null, username: null },
      from: { id: 7, isBot: false, firstName: 'Ada', lastName: 'L', username: 'ada' },
      date: 1_700_000_000,
      text: 'hello',
      entities: null,
      media: null,
      replyToMessageId: null,
    });
    expect(metadata.raw).toEqual(baseUpdate);
    // legacy aliases
    expect(metadata).toMatchObject({
      userId: 7,
      chatId: 99,
      chatType: 'private',
      isCommand: false,
      timestamp: 1_700_000_000,
      email: 'ada@telegram.placeholder',
    });
  });

  it('photo message → media metadata slice, text null, run still fires', async () => {
    const update = {
      update_id: 9,
      message: {
        ...baseUpdate.message,
        text: undefined,
        photo: [
          { file_id: 'small', file_unique_id: 'us', width: 90, height: 60 },
          {
            file_id: 'AgACAgIAAx…',
            file_unique_id: 'AQAD…',
            width: 800,
            height: 600,
            mime_type: 'image/jpeg',
          },
        ],
        caption: 'look at this',
      },
    };
    const { sendStatus } = await call({ botId: 'bot-1' }, update);

    expect(sendStatus).toHaveBeenCalledWith(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.text).toBeNull();
    expect(metadata.media).toEqual({
      type: 'photo',
      fileId: 'AgACAgIAAx…',
      uniqueId: 'AQAD…',
      mimeType: 'image/jpeg',
      caption: 'look at this',
    });
  });

  it('edited_message and callback_query are acked without a run (E2/E4 backlog)', async () => {
    await call({ botId: 'bot-1' }, { update_id: 5, edited_message: baseUpdate.message });
    await call({ botId: 'bot-1' }, { update_id: 6, callback_query: { data: 'x' } });

    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});

describe('T7 chat-type filter (Q-TG-T-03)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
    mockZapFindFirst.mockResolvedValue({ id: 'zap-1', name: 'TG Zap' });
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockTriggerUpdate.mockResolvedValue({});
  });

  it('matching chat type fires; mismatch drops with zero runs', async () => {
    mockFindMany.mockResolvedValue([
      { id: 't1', zapId: 'zap-1', zap: { trigger: { metadata: { chatTypes: ['private'] } } } },
    ]);
    await call({ botId: 'bot-1' }, baseUpdate);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);

    mockEnqueueRun.mockClear();
    const groupUpdate = {
      update_id: 2,
      message: { ...baseUpdate.message, chat: { id: -1001, type: 'group', title: 'Support' } },
    };
    await call({ botId: 'bot-1' }, groupUpdate);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('supergroup matches a group selection; absent filter passes everything', () => {
    expect(
      matchesChatTypeFilter({ ...baseUpdate.message, chat: { id: 1, type: 'supergroup' } } as any, [
        'group',
      ])
    ).toBe(true);
    expect(
      matchesChatTypeFilter({ ...baseUpdate.message, chat: { id: 1, type: 'channel' } } as any, [
        'private',
        'group',
      ])
    ).toBe(false);
    expect(matchesChatTypeFilter(baseUpdate.message as any, undefined)).toBe(true);
    expect(matchesChatTypeFilter(baseUpdate.message as any, [])).toBe(true);
  });
});

describe('T7 secret token (setWebhook path)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([{ id: 't1', zapId: 'zap-1' }]);
    mockZapFindFirst.mockResolvedValue({ id: 'zap-1', name: 'TG Zap' });
    mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
    mockTriggerUpdate.mockResolvedValue({});
  });

  it('invalid secret token → 401, no run', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
    const { res } = await call({ botId: 'bot-1' }, baseUpdate, {
      'x-telegram-bot-api-secret-token': 'wrong',
    });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('valid secret token → dispatches', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'tg-secret';
    const { sendStatus } = await call({ botId: 'bot-1' }, baseUpdate, {
      'x-telegram-bot-api-secret-token': 'tg-secret',
    });

    expect(sendStatus).toHaveBeenCalledWith(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('no secret configured → 401 and no run (fail-closed regression)', async () => {
    // Regression for the accidental fail-open: this used to return true and
    // dispatch. An unconfigured bot must be registered with a secret first.
    delete process.env.TELEGRAM_WEBHOOK_SECRET;

    const { res, sendStatus } = await call({ botId: 'bot-1' });

    expect(res.status).toHaveBeenCalledWith(401);
    expect(sendStatus).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});

describe('buildTelegramRunPayload pure helpers', () => {
  it('command messages keep command/commandArgs aliases', () => {
    const update: any = {
      update_id: 3,
      message: { ...baseUpdate.message, text: '/start now' },
    };
    const p = buildTelegramRunPayload(update, update.message);
    expect(p.text).toBe('/start now');
    expect(p.isCommand).toBe(true);
    expect(p.command).toBe('/start');
    expect(p.commandArgs).toBe('now');
    expect(p.updateId).toBe(3);
  });

  // Telegram appends `@botname` in groups (privacy mode), which is exactly where
  // command-driven Zaps are used. The mention is addressing, not an argument.
  it('strips the @botname mention from commandArgs (group-chat form)', () => {
    const update: any = {
      update_id: 4,
      message: { ...baseUpdate.message, text: '/start@zapmate_bot alpha beta' },
    };
    const p = buildTelegramRunPayload(update, update.message);
    expect(p.isCommand).toBe(true);
    expect(p.command).toBe('/start');
    expect(p.commandArgs).toBe('alpha beta');
  });

  it('has empty args for a bare mentioned command', () => {
    const update: any = {
      update_id: 5,
      message: { ...baseUpdate.message, text: '/help@zapmate_bot' },
    };
    const p = buildTelegramRunPayload(update, update.message);
    expect(p.command).toBe('/help');
    expect(p.commandArgs).toBe('');
  });

  it('does not leak the mention when argument text repeats the command', () => {
    const update: any = {
      update_id: 6,
      message: { ...baseUpdate.message, text: '/deploy@zapmate_bot deploy production' },
    };
    const p = buildTelegramRunPayload(update, update.message);
    expect(p.commandArgs).toBe('deploy production');
  });
});
