import client from '@repo/db';
import {
  kindOf,
  removeZap,
  composeZap,
} from '../../src/services/zapComposition';

/**
 * Zap composition, asserted at its own seam.
 *
 * Two things these tests protect:
 * - the trigger-kind table (an unknown type must fail loudly, not compose a Zap
 *   whose trigger can never fire), and
 * - teardown order (children before parents), which is why the fake transaction
 *   records the *order* of calls rather than just their counts.
 */

type Call = { model: string; method: string };

const orderAwareTx = (calls: Call[], overrides: Record<string, any> = {}) => {
  const models: Record<string, any> = {};
  return new Proxy(
    {},
    {
      get: (_target, model) => {
        const name = String(model);
        if (models[name]) return models[name];
        const base: any = {
          create: jest.fn(async (args: any) => {
            calls.push({ model: name, method: 'create' });
            return { id: `${name}-1`, ...(args?.data ?? {}) };
          }),
          deleteMany: jest.fn(async () => {
            calls.push({ model: name, method: 'deleteMany' });
            return { count: 0 };
          }),
          update: jest.fn(async () => {
            calls.push({ model: name, method: 'update' });
            return {};
          }),
          delete: jest.fn(async () => {
            calls.push({ model: name, method: 'delete' });
            return { id: 'zap-1' };
          }),
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => []),
        };
        models[name] = { ...base, ...(overrides[name] ?? {}) };
        return models[name];
      },
    }
  );
};

const arrangeCompose = (
  triggerType: string,
  tx: any,
  overrides: { triggerRow?: any; actionRow?: any } = {}
) => {
  (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));
  (client.availableTriggers.findUnique as jest.Mock).mockResolvedValue(
    'triggerRow' in overrides ? overrides.triggerRow : { id: 'trigger-1', type: triggerType }
  );
  (client.availableActions.findUnique as jest.Mock).mockResolvedValue(
    'actionRow' in overrides ? overrides.actionRow : { type: 'Webhook' }
  );
};

const draft = (triggerMetadata: any = {}, steps: any[] = []) => ({
  triggerId: 'trigger-1',
  triggerMetadata,
  steps,
});

describe('kindOf — the type table', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['Webhook', 'webhook'],
    ['Gmail New Email', 'gmail'],
    ['Gmail Labeled', 'gmail'],
    ['Gmail Starred', 'gmail'],
    ['Gmail From Sender', 'gmail'],
    ['Gmail Matching Search', 'gmail'],
    ['GitHub Push', 'github'],
    ['GitHub Pull Request', 'github'],
    ['GitHub Issue', 'github'],
    ['GitHub Release', 'github'],
    ['Google Sheets New Row', 'sheets'],
    ['Google Sheets Updated Row', 'sheets'],
    ['Google Calendar New Event', 'calendar'],
    ['Google Calendar Event Updated', 'calendar'],
    ['Google Calendar Event Start', 'calendar'],
    ['Google Calendar Event Ended', 'calendar'],
    ['Google Calendar Event Cancelled', 'calendar'],
    ['Google Calendar New Calendar', 'calendar'],
    ['Google Calendar Event Matching Search', 'calendar'],
    ['Schedule Every Minute', 'schedule'],
    ['Schedule Every Hour', 'schedule'],
    ['Schedule Every Day', 'schedule'],
    ['Schedule Every Week', 'schedule'],
    ['Schedule Every Month', 'schedule'],
    ['Schedule Custom Cron', 'schedule'],
    ['WhatsApp Message Received', 'whatsapp'],
    ['Telegram New Message', 'telegram'],
  ])('%s → %s', (type, kind) => {
    expect(kindOf(type)).toBe(kind);
  });

  it('refuses an unrecognised type instead of silently composing a dead Zap', () => {
    expect(() => kindOf('Gmail Calendar Sync')).toThrow(
      expect.objectContaining({ code: 'TRIGGER_KIND_UNKNOWN' })
    );
  });
});

describe('composeZap', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the base rows for a Webhook trigger and no shadow row', async () => {
    const calls: Call[] = [];
    const tx = orderAwareTx(calls);
    arrangeCompose('Webhook', tx);

    const result = await composeZap(draft({}, [{ actionId: 'a1', metadata: {}, stepConditions: [] }]), {
      userId: 1,
    });

    expect(result).toEqual({ zapId: 'zap-1' });
    expect(calls).toEqual([
      { model: 'zap', method: 'create' },
      { model: 'trigger', method: 'create' },
      { model: 'zap', method: 'update' },
    ]);
  });

  it('writes one GmailTrigger row with the internal type and watched labels', async () => {
    const calls: Call[] = [];
    const gmailTrigger = { create: jest.fn(async () => { calls.push({ model: 'gmailTrigger', method: 'create' }); return {}; }) };
    const tx = orderAwareTx(calls, { gmailTrigger });
    arrangeCompose('Gmail Labeled', tx);
    (client.gmailServer.findFirst as jest.Mock).mockResolvedValue({ id: 'gs-1', userId: 1 });

    await composeZap(
      draft({ serverId: 'gs-1', watchedLabels: 'INBOX, Work', senderFilter: 'a@b.co' }),
      { userId: 1 }
    );

    expect(gmailTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serverId: 'gs-1',
        zapId: 'zap-1',
        triggerType: 'labeled',
        watchedLabels: ['INBOX', 'Work'],
        senderFilter: 'a@b.co',
      }),
    });
  });

  it('refuses a connection that belongs to someone else', async () => {
    const calls: Call[] = [];
    arrangeCompose('Gmail New Email', orderAwareTx(calls));
    (client.gmailServer.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      composeZap(draft({ serverId: 'not-mine' }), { userId: 1 })
    ).rejects.toMatchObject({ code: 'CONNECTION_NOT_OWNED' });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('refuses a Sheets trigger without a spreadsheet instead of creating a dead Zap', async () => {
    const calls: Call[] = [];
    arrangeCompose('Google Sheets New Row', orderAwareTx(calls));

    await expect(
      composeZap(draft({ serverId: 'gs-1', sheetName: 'Sheet1' }), { userId: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_TRIGGER_METADATA' });
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('marks instant calendar triggers', async () => {
    const calls: Call[] = [];
    const googleCalendarTrigger = {
      create: jest.fn(async () => {
        calls.push({ model: 'googleCalendarTrigger', method: 'create' });
        return {};
      }),
    };
    const tx = orderAwareTx(calls, { googleCalendarTrigger });
    arrangeCompose('Google Calendar New Event', tx);

    await composeZap(draft({ serverId: 'gcal-1', calendarId: 'primary' }), { userId: 1 });

    expect(googleCalendarTrigger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ triggerType: 'new_event', isInstant: true }),
    });
  });

  it('refuses an unknown available trigger id', async () => {
    const calls: Call[] = [];
    arrangeCompose('Webhook', orderAwareTx(calls), { triggerRow: null });

    await expect(composeZap(draft(), { userId: 1 })).rejects.toMatchObject({
      code: 'UNKNOWN_TRIGGER',
    });
  });

  it('maps rejected AI metadata to INVALID_ACTION_METADATA', async () => {
    const calls: Call[] = [];
    arrangeCompose('Webhook', orderAwareTx(calls), { actionRow: null });

    await expect(
      composeZap(draft({}, [{ actionId: 'missing', metadata: {}, stepConditions: [] }]), {
        userId: 1,
      })
    ).rejects.toMatchObject({ code: 'INVALID_ACTION_METADATA' });
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe('removeZap — teardown order', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes children before parents, and every shadow table', async () => {
    const calls: Call[] = [];
    const tx = orderAwareTx(calls, {
      zapRun: {
        findMany: jest.fn(async () => {
          calls.push({ model: 'zapRun', method: 'findMany' });
          return [{ id: 'run-1' }];
        }),
        deleteMany: jest.fn(async () => {
          calls.push({ model: 'zapRun', method: 'deleteMany' });
          return { count: 1 };
        }),
      },
    });
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await removeZap('zap-1', { userId: 1 });

    const models = calls.map((call) => `${call.model}.${call.method}`);

    expect(models[0]).toBe('zapRun.findMany');
    expect(models[1]).toBe('zapRunOutbox.deleteMany');
    expect(models.indexOf('zapRun.deleteMany')).toBeLessThan(
      models.indexOf('gmailTrigger.deleteMany')
    );
    for (const shadow of [
      'gmailTrigger.deleteMany',
      'googleSheetsTrigger.deleteMany',
      'googleCalendarTrigger.deleteMany',
      'scheduledTrigger.deleteMany',
      'whatsAppTrigger.deleteMany',
      'telegramTrigger.deleteMany',
    ]) {
      expect(models).toContain(shadow);
    }
    expect(models.indexOf('action.deleteMany')).toBeLessThan(models.indexOf('zap.delete'));
    expect(models[models.length - 1]).toBe('zap.delete');
  });

  it('scopes the final delete to the caller', async () => {
    const calls: Call[] = [];
    const tx = orderAwareTx(calls);
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(tx));

    await removeZap('zap-1', { userId: 42 });

    const zapModel = (tx as any).zap;
    expect(zapModel.delete).toHaveBeenCalledWith({ where: { id: 'zap-1', userId: 42 } });
  });
});
