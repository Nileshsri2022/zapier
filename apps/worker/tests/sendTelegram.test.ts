import {
  CAPTION_LIMIT,
  TEXT_LIMIT,
  TelegramActionError,
  assertMediaSource,
  normalizeChatTarget,
  normalizeParseMode,
  sendTelegramAction,
} from '../src/sendTelegram';

/**
 * A6 spec acceptance (docs/ask-matt/actions/telegram.md, grilled round 16):
 * Q-TG-A-01 text + photo/document · Q-TG-A-02 parse mode off by default ·
 * Q-TG-A-03 ids + @usernames · Q-TG-A-04 fail loudly over the limit ·
 * Q-TG-A-05 previews off / silent / reply-to.
 */

const BOT = { id: 'bot-1', botToken: '123456:SECRET-TOKEN', botUsername: 'zm_bot' };
const RUN = { userId: 7 };
const dbWith = (bot: any = BOT) => ({ telegramBot: { findFirst: jest.fn(async () => bot) } });

const telegramOk = (overrides: Record<string, any> = {}) =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      result: {
        message_id: 12099,
        date: 1_761_012_842,
        chat: { id: -1001234567890, type: 'channel', title: 'Ops', ...overrides.chat },
        ...overrides,
      },
    }),
  }) as unknown as Response;

const telegramError = (status: number, body: any) =>
  ({ ok: false, status, json: async () => body }) as unknown as Response;

const calls = (fetchImpl: typeof fetch) => (fetchImpl as unknown as jest.Mock).mock.calls;
const lastPayload = (fetchImpl: typeof fetch) => JSON.parse(calls(fetchImpl).at(-1)[1].body);

describe('Q-TG-A-01 text sends (§4 output)', () => {
  it('posts text and returns messageId/chat/date/text', async () => {
    const fetchImpl = jest.fn(async () => telegramOk()) as unknown as typeof fetch;
    const out = await sendTelegramAction(
      { botId: 'bot-1', chatId: '-1001234567890', text: 'Order {{previousOutput.fields.id}} shipped 📦' },
      { ...RUN, previousOutput: { fields: { id: '42' } } },
      { fetchImpl, db: dbWith() as any }
    );

    expect(out).toEqual({
      sent: true,
      messageId: 12099,
      chat: { id: -1001234567890, type: 'channel', title: 'Ops' },
      date: 1_761_012_842,
      text: 'Order 42 shipped 📦',
      apiResponse: { ok: true },
      error: null,
    });
    const [url, init] = calls(fetchImpl)[0];
    expect(url).toBe(`https://api.telegram.org/bot${BOT.botToken}/sendMessage`);
    expect((init as any).headers['Content-Type']).toBe('application/json');
    expect(lastPayload(fetchImpl).chat_id).toBe(-1001234567890);
  });

  it('resolves the bot from the shared connection and rejects foreign bots', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendTelegramAction(
        { botId: 'bot-1', chatId: '123', text: 'hi' },
        RUN,
        { fetchImpl, db: dbWith(null) as any }
      )
    ).rejects.toMatchObject({ code: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Q-TG-A-02 parse modes', () => {
  it('defaults to no parse mode and accepts HTML / MarkdownV2', async () => {
    expect(normalizeParseMode(undefined)).toBeUndefined();
    expect(normalizeParseMode('none')).toBeUndefined();
    expect(normalizeParseMode('HTML')).toBe('HTML');
    expect(normalizeParseMode('MarkdownV2')).toBe('MarkdownV2');
    expect(() => normalizeParseMode('Markdown')).toThrow(
      expect.objectContaining({ code: 'validation' })
    );

    const fetchImpl = jest.fn(async () => telegramOk()) as unknown as typeof fetch;
    await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: '<b>hi</b>' },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(lastPayload(fetchImpl).parse_mode).toBeUndefined();

    await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: '<b>hi</b>', parseMode: 'HTML' },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(lastPayload(fetchImpl).parse_mode).toBe('HTML');
  });

  it('classifies bad markup as parse_error with API detail', async () => {
    const fetchImpl = jest.fn(async () =>
      telegramError(400, {
        ok: false,
        description: "Bad Request: can't parse entities: Unsupported start tag \"foo\" at byte offset 4",
      })
    ) as unknown as typeof fetch;

    const error = await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: '<foo>x</foo>', parseMode: 'HTML' },
      RUN,
      { fetchImpl, db: dbWith() as any }
    ).then(
      () => null,
      (rejection: TelegramActionError) => rejection
    );
    expect(error!.code).toBe('parse_error');
    expect(error!.message).toContain('byte offset 4');
  });
});

describe('Q-TG-A-04 over-limit fails loudly', () => {
  it('rejects >4096 characters pre-send with current/max lengths', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const error = await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: 'x'.repeat(TEXT_LIMIT + 1) },
      RUN,
      { fetchImpl, db: dbWith() as any }
    ).then(
      () => null,
      (rejection: TelegramActionError) => rejection
    );
    expect(error!.code).toBe('message_too_long');
    expect(error!.message).toContain('4097');
    expect(error!.message).toContain('4096');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects captions over 1024 characters', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200 }) as Response) as unknown as typeof fetch;
    await expect(
      sendTelegramAction(
        {
          botId: 'bot-1',
          chatId: '123',
          media: { kind: 'photo', source: 'https://cdn.example.com/p.png', caption: 'x'.repeat(CAPTION_LIMIT + 1) },
        },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'caption_too_long' });
  });

  it('accepts exactly 4096 characters', async () => {
    const fetchImpl = jest.fn(async () => telegramOk()) as unknown as typeof fetch;
    await expect(
      sendTelegramAction(
        { botId: 'bot-1', chatId: '123', text: 'x'.repeat(TEXT_LIMIT) },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).resolves.toMatchObject({ sent: true });
  });
});

describe('Q-TG-A-03 chat targeting', () => {
  it('accepts numeric ids (including negative) and @usernames, rejects garbage', () => {
    expect(normalizeChatTarget('-1001234567890')).toBe(-1001234567890);
    expect(normalizeChatTarget('123456789')).toBe(123456789);
    expect(normalizeChatTarget('@ops_channel')).toBe('@ops_channel');
    for (const value of ['', 'ops channel', '@ab', 'https://t.me/x'])
      expect(() => normalizeChatTarget(value)).toThrow(
        expect.objectContaining({ code: 'validation' })
      );
  });

  it('classifies unknown chats as chat_not_found', async () => {
    const fetchImpl = jest.fn(async () =>
      telegramError(400, { ok: false, description: 'Bad Request: chat not found' })
    ) as unknown as typeof fetch;
    await expect(
      sendTelegramAction({ botId: 'bot-1', chatId: '-100999', text: 'hi' }, RUN, {
        fetchImpl,
        db: dbWith() as any,
      })
    ).rejects.toMatchObject({ code: 'chat_not_found' });
  });
});

describe('Q-TG-A-01 media sends', () => {
  it('sends a photo with caption after verifying the URL', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      String(url).includes('api.telegram.org') ? telegramOk() : ({ ok: true, status: 200 } as Response)
    ) as unknown as typeof fetch;

    const out = await sendTelegramAction(
      {
        botId: 'bot-1',
        chatId: '-1001234567890',
        media: { kind: 'photo', source: 'https://cdn.example.com/label.png', caption: 'Label preview' },
      },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(out.text).toBe('Label preview');
    const [url] = calls(fetchImpl).at(-1);
    expect(String(url)).toContain('/sendPhoto');
    expect(lastPayload(fetchImpl).photo).toBe('https://cdn.example.com/label.png');
    expect(lastPayload(fetchImpl).caption).toBe('Label preview');
  });

  it('supports a stable file_id without probing', async () => {
    const fetchImpl = jest.fn(async () => telegramOk()) as unknown as typeof fetch;
    await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', media: { kind: 'document', source: 'BQACAgQAAxk-file-id' } },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(calls(fetchImpl)).toHaveLength(1);
    expect(lastPayload(fetchImpl).document).toBe('BQACAgQAAxk-file-id');
  });

  it('fails the run when media is unreachable (no text substitute)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch;
    await expect(
      sendTelegramAction(
        {
          botId: 'bot-1',
          chatId: '123',
          media: { kind: 'photo', source: 'https://cdn.example.com/missing.png', caption: 'x' },
        },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'media_fetch_failed' });
    expect(calls(fetchImpl)).toHaveLength(1);
    await expect(assertMediaSource('', fetchImpl)).rejects.toMatchObject({ code: 'validation' });
  });

  it('rejects unsupported media kinds and empty messages', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendTelegramAction(
        { botId: 'bot-1', chatId: '123', media: { kind: 'video', source: 'https://x/y.mp4' } },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      sendTelegramAction({ botId: 'bot-1', chatId: '123', text: '   ' }, RUN, {
        fetchImpl,
        db: dbWith() as any,
      })
    ).rejects.toMatchObject({ code: 'validation' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Q-TG-A-05 options and error classes', () => {
  it('disables link previews by default and honours toggles/reply-to', async () => {
    const fetchImpl = jest.fn(async () => telegramOk()) as unknown as typeof fetch;
    await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: 'see https://example.com' },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(lastPayload(fetchImpl).link_preview_options).toEqual({ is_disabled: true });

    await sendTelegramAction(
      {
        botId: 'bot-1',
        chatId: '123',
        text: 'linked',
        linkPreview: true,
        silent: true,
        replyToMessageId: 77,
      },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    const payload = lastPayload(fetchImpl);
    expect(payload.link_preview_options).toEqual({ is_disabled: false });
    expect(payload.disable_notification).toBe(true);
    expect(payload.reply_to_message_id).toBe(77);
  });

  it('maps 403, 401, 409 and 429 to actionable classes', async () => {
    const cases: [number, any, string][] = [
      [403, { description: 'Forbidden: bot is not a member of the channel chat' }, 'forbidden'],
      [401, { description: 'Unauthorized' }, 'auth'],
      [409, { description: 'Conflict: terminated by other getUpdates request' }, 'conflict'],
      [429, { description: 'Too Many Requests', parameters: { retry_after: 7 } }, 'rate_limited'],
    ];
    for (const [status, body, code] of cases) {
      const fetchImpl = jest.fn(async () => telegramError(status, { ok: false, ...body })) as unknown as typeof fetch;
      await expect(
        sendTelegramAction({ botId: 'bot-1', chatId: '123', text: 'hi' }, RUN, {
          fetchImpl,
          db: dbWith() as any,
        })
      ).rejects.toMatchObject({ code });
    }

    const limited = jest.fn(async () =>
      telegramError(429, { ok: false, description: 'Too Many Requests', parameters: { retry_after: 7 } })
    ) as unknown as typeof fetch;
    const error = await sendTelegramAction({ botId: 'bot-1', chatId: '123', text: 'hi' }, RUN, {
      fetchImpl: limited,
      db: dbWith() as any,
    }).then(
      () => null,
      (rejection: TelegramActionError) => rejection
    );
    expect(error!.retryable).toBe(true);
    expect(error!.retryAfter).toBe(7);
  });

  it('never leaks the bot token', async () => {
    const fetchImpl = jest.fn(async () =>
      telegramError(500, { description: 'Internal Server Error' })
    ) as unknown as typeof fetch;
    const error = await sendTelegramAction({ botId: 'bot-1', chatId: '123', text: 'hi' }, RUN, {
      fetchImpl,
      db: dbWith() as any,
    }).then(
      () => null,
      (rejection: TelegramActionError) => rejection
    );
    expect(error!.message).not.toContain('SECRET-TOKEN');
    expect(error!.code).toBe('provider');
  });
});
