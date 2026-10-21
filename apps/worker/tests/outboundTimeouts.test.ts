import { sendTelegramAction } from '../src/sendTelegram';

/**
 * Every outbound provider call must be bounded. WhatsApp/Telegram now share the
 * same fetch transport with an AbortSignal + timer (A5/A6), so the guard is the
 * presence of an abort signal wired to a timeout.
 */
const db = {
  telegramBot: {
    findFirst: jest.fn(async () => ({ id: 'bot-1', botToken: '123:abc', botUsername: 'zm_bot' })),
  },
};

const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    result: { message_id: 1, date: 1_761_000_000, chat: { id: 123, type: 'private' } },
  }),
} as unknown as Response;

describe('outbound Telegram requests', () => {
  it('sends through a bounded (abort-signalled) transport', async () => {
    const fetchImpl = jest.fn(async () => okResponse) as unknown as typeof fetch;
    await sendTelegramAction(
      { botId: 'bot-1', chatId: '123', text: 'hello' },
      { userId: 1 },
      { fetchImpl, db: db as any }
    );

    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(String(url)).toContain('/sendMessage');
    expect((init as any).signal).toBeDefined();
    expect((init as any).signal.aborted).toBe(false);
  });
});
