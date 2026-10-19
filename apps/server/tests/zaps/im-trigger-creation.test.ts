import { Request, Response } from 'express';
import client from '@repo/db';
import * as ZapController from '../../src/controllers/ZapController';

/**
 * Publishing a Zap with a WhatsApp/Telegram trigger must create the
 * provider-specific trigger row so inbound messages can find the Zap.
 */

const makeRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const request = (triggerType: string, triggerMetaData: any) =>
  ({
    body: {
      availableTriggerId: `trigger-${triggerType}`,
      triggerMetaData,
      actions: [],
    },
    // @ts-ignore
    id: '1',
  }) as unknown as Request;

const buildTx = (triggerType: string) => {
  const tx: any = {
    availableTriggers: { findUnique: jest.fn().mockResolvedValue({ type: triggerType }) },
    zap: {
      create: jest.fn().mockResolvedValue({ id: 'zap-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    trigger: { create: jest.fn().mockResolvedValue({ id: 'trigger-1' }) },
    googleSheetsTrigger: { create: jest.fn() },
    googleCalendarTrigger: { create: jest.fn() },
    scheduledTrigger: { create: jest.fn() },
    whatsAppServer: { findFirst: jest.fn().mockResolvedValue({ id: 'wserver-1', userId: 1 }) },
    whatsAppTrigger: { create: jest.fn().mockResolvedValue({ id: 'wtrigger-1' }) },
    telegramBot: { findFirst: jest.fn().mockResolvedValue({ id: 'bot-1', userId: 1 }) },
    telegramTrigger: { create: jest.fn().mockResolvedValue({ id: 'ttrigger-1' }) },
  };
  return tx;
};

describe('createZap — WhatsApp/Telegram trigger rows', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a WhatsApp trigger owned by the caller', async () => {
    const tx = buildTx('WhatsApp Message Received');
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const { res, status } = makeRes();
    await ZapController.createZap(
      request('WhatsApp Message Received', { serverId: 'wserver-1' }),
      res
    );

    expect(status).toHaveBeenCalledWith(201);
    expect(tx.whatsAppServer.findFirst).toHaveBeenCalledWith({
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
    const tx = buildTx('Telegram New Message');
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const { res, status } = makeRes();
    await ZapController.createZap(request('Telegram New Message', { botId: 'bot-1' }), res);

    expect(status).toHaveBeenCalledWith(201);
    expect(tx.telegramBot.findFirst).toHaveBeenCalledWith({
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

  it("rejects another user's WhatsApp server", async () => {
    const tx = buildTx('WhatsApp Message Received');
    tx.whatsAppServer.findFirst.mockResolvedValue(null);
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    const { res, status } = makeRes();
    await ZapController.createZap(
      request('WhatsApp Message Received', { serverId: 'someone-elses' }),
      res
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(tx.whatsAppTrigger.create).not.toHaveBeenCalled();
  });
});
