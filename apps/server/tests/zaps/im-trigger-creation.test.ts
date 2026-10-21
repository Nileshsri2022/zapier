import client from '@repo/db';
import { composeZap } from '../../src/services/zapComposition';

/**
 * WhatsApp/Telegram composition: the provider-specific trigger row is what
 * makes an inbound message find the Zap, and the connection must belong to the
 * caller. Asserted at the module's seam — the HTTP status mapping for these
 * failures lives in tests/zaps/zap-crud.test.ts.
 */

const buildTx = () => ({
  zap: {
    create: jest.fn().mockResolvedValue({ id: 'zap-1' }),
    update: jest.fn().mockResolvedValue({}),
  },
  trigger: { create: jest.fn().mockResolvedValue({ id: 'trigger-1' }) },
  whatsAppTrigger: { create: jest.fn().mockResolvedValue({ id: 'wtrigger-1' }) },
  telegramTrigger: { create: jest.fn().mockResolvedValue({ id: 'ttrigger-1' }) },
});

const arrange = (triggerType: string, tx: ReturnType<typeof buildTx>) => {
  (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue({
    id: `trigger-${triggerType}`,
    type: triggerType,
  });
  (client.availableActions.findUnique as jest.Mock).mockResolvedValue({ type: 'Webhook' });
};

const send = (triggerType: string, triggerMetadata: any) =>
  composeZap({ triggerId: `trigger-${triggerType}`, triggerMetadata, steps: [] }, { userId: 1 });

describe('composeZap — WhatsApp/Telegram trigger rows', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a WhatsApp trigger owned by the caller', async () => {
    const tx = buildTx();
    arrange('WhatsApp Message Received', tx);
    (client.whatsAppServer.findFirst as jest.Mock).mockResolvedValue({
      id: 'wserver-1',
      userId: 1,
    });

    await send('WhatsApp Message Received', { serverId: 'wserver-1' });

    expect(client.whatsAppServer.findFirst).toHaveBeenCalledWith({
      where: { id: 'wserver-1', userId: 1 },
    });
    expect(tx.whatsAppTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serverId: 'wserver-1',
        zapId: 'zap-1',
        eventType: 'message_received',
      }),
    });
  });

  it('creates a Telegram trigger owned by the caller', async () => {
    const tx = buildTx();
    arrange('Telegram New Message', tx);
    (client.telegramBot.findFirst as jest.Mock).mockResolvedValue({
      id: 'bot-1',
      userId: 1,
    });

    await send('Telegram New Message', { botId: 'bot-1' });

    expect(client.telegramBot.findFirst).toHaveBeenCalledWith({
      where: { id: 'bot-1', userId: 1 },
    });
    expect(tx.telegramTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        botId: 'bot-1',
        zapId: 'zap-1',
        eventType: 'message',
      }),
    });
  });

  it("refuses another user's WhatsApp server without writing anything", async () => {
    const tx = buildTx();
    arrange('WhatsApp Message Received', tx);
    (client.whatsAppServer.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      send('WhatsApp Message Received', { serverId: 'someone-elses' })
    ).rejects.toMatchObject({ code: 'CONNECTION_NOT_OWNED' });

    expect(tx.whatsAppTrigger.create).not.toHaveBeenCalled();
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('requires a connection id at all', async () => {
    const tx = buildTx();
    arrange('Telegram New Message', tx);

    await expect(send('Telegram New Message', {})).rejects.toMatchObject({
      code: 'MISSING_CONNECTION',
    });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});
