const gmailServerFindFirst = jest.fn();
const gmailTriggerCreate = jest.fn();

jest.mock('@repo/db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(async (fn: any) =>
      fn({
        availableTriggers: {
          findUnique: jest.fn().mockResolvedValue({ id: 'trig-gmail-labeled', type: 'Gmail Labeled' }),
        },
        zap: {
          create: jest.fn().mockResolvedValue({ id: 'zap-gmail-1' }),
          update: jest.fn().mockResolvedValue({ id: 'zap-gmail-1' }),
        },
        trigger: {
          create: jest.fn().mockResolvedValue({ id: 'trig-row-1' }),
        },
        gmailServer: {
          findFirst: (...args: any[]) => gmailServerFindFirst(...args),
        },
        gmailTrigger: {
          create: (...args: any[]) => gmailTriggerCreate(...args),
        },
      })
    ),
  },
}));

import { createZap } from '../../src/controllers/ZapController';
import { shouldTrigger } from '../../src/services/GmailDispatch';

describe('Gmail Trigger Creation & Filter Evaluation Seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a GmailTrigger record with parsed watchedLabels when creating a Gmail Zap', async () => {
    gmailServerFindFirst.mockResolvedValue({ id: 'gmail-srv-1', userId: 7 });
    gmailTriggerCreate.mockResolvedValue({ id: 'gt-1' });

    const req: any = {
      id: '7',
      body: {
        availableTriggerId: 'trig-gmail-labeled',
        triggerMetaData: {
          serverId: 'gmail-srv-1',
          watchedLabels: 'INBOX, IMPORTANT , BILLING',
          senderFilter: 'billing@stripe.com',
        },
        actions: [],
      },
    };
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      json(p: any) {
        this.body = p;
        return this;
      },
    };

    await createZap(req, res);

    expect(res.statusCode).toBe(201);
    expect(gmailServerFindFirst).toHaveBeenCalledWith({
      where: { id: 'gmail-srv-1', userId: 7 },
    });
    expect(gmailTriggerCreate).toHaveBeenCalledWith({
      data: {
        serverId: 'gmail-srv-1',
        zapId: 'zap-gmail-1',
        triggerType: 'labeled',
        watchedLabels: ['INBOX', 'IMPORTANT', 'BILLING'],
        senderFilter: 'billing@stripe.com',
        subjectFilter: null,
        metadata: {
          targetLabels: ['INBOX', 'IMPORTANT', 'BILLING'],
        },
      },
    });
  });

  it('evaluates shouldTrigger for labeled (via watchedLabels) and from_sender triggers', async () => {
    const labeledMatch = await shouldTrigger(
      {
        triggerType: 'labeled',
        watchedLabels: ['URGENT'],
        metadata: {},
      },
      { labels: ['INBOX', 'URGENT'], from: 'a@b.com', subject: 'hi' }
    );
    expect(labeledMatch).toBe(true);

    const fromSenderMatch = await shouldTrigger(
      {
        triggerType: 'from_sender',
        senderFilter: 'ceo@company.com',
        metadata: {},
      },
      { labels: ['INBOX'], from: 'The CEO <ceo@company.com>', subject: 'Q4 Plan' }
    );
    expect(fromSenderMatch).toBe(true);

    const fromSenderMiss = await shouldTrigger(
      {
        triggerType: 'from_sender',
        senderFilter: 'ceo@company.com',
        metadata: {},
      },
      { labels: ['INBOX'], from: 'newsletter@spam.io', subject: 'Promo' }
    );
    expect(fromSenderMiss).toBe(false);
  });
});
