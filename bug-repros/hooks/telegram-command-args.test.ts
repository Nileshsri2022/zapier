/**
 * BUG: Telegram command arguments keep the @botname mention.
 * apps/hooks/src/telegramHandler.ts:92-93:
 *
 *   const command = isCommand ? message.text!.split(' ')[0].split('@')[0] : null;
 *   const commandArgs = isCommand ? message.text!.slice(command!.length).trim() : null;
 *
 * `command` has the mention stripped, but `commandArgs` slices by the STRIPPED
 * length, so for `/start@zapmate_bot alpha beta` the run metadata carries
 * `commandArgs: '@zapmate_bot alpha beta'`. Telegram sends the mention form in
 * group chats (privacy mode), i.e. exactly the case where command triggers are
 * used. Downstream actions that template `{commandArgs}` forward the bot handle
 * to the user's API/WhatsApp/Telegram message, and any `filterCommand`-style
 * argument matching is off by the mention.
 *
 * Expected (green): commandArgs === 'alpha beta'.
 */
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

import { handleTelegramWebhook } from '../../apps/hooks/src/telegramHandler';

const updateWithText = (text: string) => ({
  update_id: 1,
  message: {
    message_id: 42,
    from: { id: 7, first_name: 'Ada', username: 'ada', is_bot: false },
    chat: { id: 99, type: 'group', title: 'Ops' },
    date: 1_700_000_000,
    text,
  },
});

const send = async (text: string) => {
  const sendStatus = jest.fn();
  const res = { sendStatus, status: jest.fn().mockReturnValue({ json: jest.fn() }) };
  await handleTelegramWebhook(
    { body: updateWithText(text), params: { botId: 'bot-1' } } as any,
    res as any
  );
  return { sendStatus, metadata: mockEnqueueRun.mock.calls[0]?.[0]?.metadata };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFindMany.mockResolvedValue([{ id: 't1', zapId: 'zap-1' }]);
  mockZapFindFirst.mockResolvedValue({ id: 'zap-1', name: 'Command Zap' });
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1' });
});

describe('Telegram command parsing', () => {
  it('strips the @botname mention from commandArgs (group chat form)', async () => {
    const { metadata } = await send('/start@zapmate_bot alpha beta');

    expect(metadata.command).toBe('/start');
    expect(metadata.commandArgs).toBe('alpha beta');
  });

  it('has empty args for a bare mentioned command', async () => {
    const { metadata } = await send('/help@zapmate_bot');

    expect(metadata.command).toBe('/help');
    expect(metadata.commandArgs).toBe('');
  });

  it('still parses a plain command without a mention (control)', async () => {
    const { metadata } = await send('/start alpha beta');

    expect(metadata.command).toBe('/start');
    expect(metadata.commandArgs).toBe('alpha beta');
  });
});
