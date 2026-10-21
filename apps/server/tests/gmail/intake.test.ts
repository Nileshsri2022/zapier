import client from '@repo/db';

/**
 * Gmail intake (services/gmailIntake.ts).
 *
 * The Gmail client is replaced through the module's own deps seam, so no test
 * reaches Google and no module-path mock is needed. Run intake is a stateful
 * in-memory fake reproducing its documented result contract (first-seen key
 * enqueues, replay is a duplicate); the durable transaction itself is covered
 * once, in packages/runs/tests/intake.test.ts.
 */

const intakeSeen = new Set<string>();
const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import {
  intakeGmailDelivery,
  processHistoryDelta,
  shouldTrigger,
  mapGmailEventType,
  mapHistoryRecords,
} from '../../src/services/gmailIntake';

const installIntakeFake = () => {
  intakeSeen.clear();
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockImplementation(async (input: any) => {
    const key = input.dedup?.key;
    if (key && intakeSeen.has(key)) {
      return { status: 'duplicate' };
    }
    if (key) intakeSeen.add(key);
    return { status: 'queued', zapRunId: 'run-1', dispatched: true };
  });
};

const fakeService = {
  getEmailMetadata: jest.fn(),
  getEmailContent: jest.fn(),
  getAttachments: jest.fn(),
  listHistory: jest.fn(),
  watchEmails: jest.fn(),
  getProfileEmail: jest.fn(),
};

const deps = { createService: () => fakeService as any };

const server = {
  id: 'server-1',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  accessToken: 'access-token',
  tokenExpiry: null,
  email: 'owner@gmail.com',
  isActive: true,
};

const hydratedMetadata = {
  id: 'msg-1',
  threadId: 'thread-1',
  snippet: 'Please pay invoice 42',
  from: 'Priya <Priya@example.com>',
  to: ['owner@example.com'],
  subject: 'Invoice 42 overdue',
  date: new Date('2026-10-19T10:00:00.000Z'),
  labels: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  isRead: false,
};

const triggerRow = (overrides: any = {}) => ({
  triggerType: 'new_email',
  watchedLabels: [],
  senderFilter: null,
  subjectFilter: null,
  metadata: {},
  zap: { id: 'zap-1', isActive: true },
  ...overrides,
});

const legacyDelivery = (event: any = {}) => ({
  source: 'legacy' as const,
  emailAddress: 'owner@gmail.com',
  event: { eventType: 'new_email', messageId: 'msg-1', ...event },
});

const pubsubDelivery = (overrides: any = {}) => ({
  source: 'pubsub' as const,
  emailAddress: 'owner@gmail.com',
  historyId: '150',
  ...overrides,
});

let warnSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  installIntakeFake();
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('intakeGmailDelivery — legacy delivery (hydrate → match → enqueue)', () => {
  beforeEach(() => {
    fakeService.getEmailMetadata.mockReset().mockResolvedValue({ ...hydratedMetadata });
    fakeService.getEmailContent
      .mockReset()
      .mockResolvedValue({ body: 'Please pay invoice 42 by Friday.', truncated: false });
    fakeService.getAttachments.mockReset().mockResolvedValue([]);
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([server]);
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
  });

  it('hands the §4.3 payload to run intake with a Zap+message+event dedup key', async () => {
    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result).toEqual({ runsEnqueued: 1 });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);

    const input = mockEnqueueRun.mock.calls[0][0];
    expect(input.zapId).toBe('zap-1');
    expect(input.source).toBe('server.gmail');
    expect(input.dedup).toEqual({ scope: 'gmail', key: 'zap-1:msg-1:new_email' });
    expect(input.metadata).toMatchObject({
      id: 'msg-1',
      messageId: 'msg-1',
      threadId: 'thread-1',
      eventType: 'new_email',
      from: 'Priya <Priya@example.com>',
      subject: 'Invoice 42 overdue',
      snippet: 'Please pay invoice 42',
      body: 'Please pay invoice 42 by Friday.',
      bodyTruncated: false,
      labels: ['INBOX', 'UNREAD'],
      labelIds: ['INBOX', 'UNREAD'],
      date: '2026-10-19T10:00:00.000Z',
      hasAttachments: false,
      isRead: false,
      serverId: 'server-1',
    });
    expect(typeof input.metadata.timestamp).toBe('string');
  });

  it('logs one structured intake line with the enqueued count', async () => {
    await intakeGmailDelivery(legacyDelivery(), deps);

    expect(logSpy).toHaveBeenCalledWith('gmail intake', {
      emailAddress: 'owner@gmail.com',
      runsEnqueued: 1,
    });
  });

  it('hydrates once even when several Zaps match', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow(),
      triggerRow({ zap: { id: 'zap-2', isActive: true } }),
    ]);

    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result.runsEnqueued).toBe(2);
    expect(fakeService.getEmailMetadata).toHaveBeenCalledTimes(1);
    expect(fakeService.getEmailContent).toHaveBeenCalledTimes(1);
  });

  it('enqueues one run per Zap on a mailbox with three triggers (no LIMIT 1)', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow(),
      triggerRow({ zap: { id: 'zap-2', isActive: true } }),
      triggerRow({ zap: { id: 'zap-3', isActive: true } }),
    ]);

    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result.runsEnqueued).toBe(3);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(3);
    // The matching read must stay unbounded — the single-Zap path it replaced
    // must not have smuggled an implicit LIMIT 1 back in.
    expect(client.gmailTrigger.findMany).toHaveBeenCalledWith({
      where: { serverId: 'server-1' },
      include: { zap: true },
    });
  });

  it('counts an inactive-Zap decision from run intake as not enqueued', async () => {
    mockEnqueueRun.mockResolvedValue({ status: 'skipped', reason: 'zap_inactive' });

    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result).toEqual({ runsEnqueued: 0 });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('applies sender/subject filters against the hydrated payload (audit B4)', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ senderFilter: 'someone-else' }),
    ]);
    let result = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(result.runsEnqueued).toBe(0);

    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ senderFilter: 'Priya', subjectFilter: 'invoice' }),
    ]);
    result = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(result.runsEnqueued).toBe(1);
  });

  it('dedups a redelivered event per Zap+message+event, but a later star still fires', async () => {
    const first = await intakeGmailDelivery(legacyDelivery(), deps);
    const replay = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(first.runsEnqueued).toBe(1);
    expect(replay).toEqual({ runsEnqueued: 0 });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);

    // Same message, different event kind = legitimate second run.
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ triggerType: 'starred' }),
    ]);
    fakeService.getEmailMetadata.mockResolvedValue({
      ...hydratedMetadata,
      labels: ['INBOX', 'STARRED'],
    });
    const starred = await intakeGmailDelivery(legacyDelivery({ eventType: 'starred' }), deps);
    expect(starred.runsEnqueued).toBe(1);
  });

  it('throws with zero rows written when hydration fails', async () => {
    fakeService.getEmailMetadata.mockResolvedValue(null);

    await expect(intakeGmailDelivery(legacyDelivery(), deps)).rejects.toThrow(
      /hydrate Gmail message msg-1/i
    );
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(client.gmailTrigger.findMany).not.toHaveBeenCalled();
  });

  it('one failing Zap does not block its siblings', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow(),
      triggerRow({ zap: { id: 'zap-2', isActive: true } }),
    ]);
    mockEnqueueRun
      .mockRejectedValueOnce(new Error('db write failed'))
      .mockResolvedValueOnce({ status: 'queued', zapRunId: 'run-2', dispatched: true });

    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result).toEqual({ runsEnqueued: 1 });
  });

  it('warns and enqueues nothing for a relay delivery with no message id', async () => {
    const result = await intakeGmailDelivery(
      legacyDelivery({ messageId: undefined }),
      deps
    );

    expect(result).toEqual({ runsEnqueued: 0 });
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('gmail intake: legacy delivery carries no message id', {
      emailAddress: 'owner@gmail.com',
    });
  });
});

describe('intakeGmailDelivery — mailbox resolution', () => {
  beforeEach(() => {
    fakeService.getEmailMetadata.mockReset().mockResolvedValue({ ...hydratedMetadata });
    fakeService.getEmailContent.mockReset().mockResolvedValue({ body: 'body', truncated: false });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
  });

  it('resolves the servers from the notification address only', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([server]);

    await intakeGmailDelivery(legacyDelivery(), deps);

    expect(client.gmailServer.findMany).toHaveBeenCalledWith({
      where: { email: 'owner@gmail.com', isActive: true },
    });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('fans out when two users connected the same mailbox', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      server,
      { ...server, id: 'server-2' },
    ]);
    // Each mailbox connection belongs to its own user, so each has its own Zap.
    (client.gmailTrigger.findMany as jest.Mock)
      .mockResolvedValueOnce([triggerRow()])
      .mockResolvedValueOnce([triggerRow({ zap: { id: 'zap-2', isActive: true } })]);

    const result = await intakeGmailDelivery(legacyDelivery(), deps);

    expect(result.runsEnqueued).toBe(2);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);
  });

  it('warns with a machine-readable reason when no server is connected', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([]);

    const result = await intakeGmailDelivery(
      legacyDelivery({ messageId: 'msg-1' }),
      deps
    );

    expect(result).toEqual({ runsEnqueued: 0 });
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('gmail intake: no active server', {
      emailAddress: 'owner@gmail.com',
      reason: 'no_active_server',
    });
  });

  it('rejects an untyped delivery with an unknown source', async () => {
    await expect(
      intakeGmailDelivery({ source: 'carrier-pigeon', emailAddress: 'a@b.c' } as any, deps)
    ).rejects.toThrow(/unknown source/);
  });
});

describe('intakeGmailDelivery — Pub/Sub delivery (history delta)', () => {
  const serverWithCursor = { ...server, lastHistoryId: '100' };

  beforeEach(() => {
    fakeService.getEmailMetadata.mockReset().mockResolvedValue({ ...hydratedMetadata });
    fakeService.getEmailContent.mockReset().mockResolvedValue({ body: 'body', truncated: false });
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([serverWithCursor]);
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});
  });

  it('reads the delta for the notified mailbox and advances the cursor', async () => {
    fakeService.listHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);

    const result = await intakeGmailDelivery(pubsubDelivery(), deps);

    expect(fakeService.listHistory).toHaveBeenCalledWith('100');
    expect(result.runsEnqueued).toBe(1);
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('propagates a hydration failure so the provider redelivers', async () => {
    fakeService.listHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);
    fakeService.getEmailMetadata.mockResolvedValue(null);

    await expect(intakeGmailDelivery(pubsubDelivery(), deps)).rejects.toThrow(/hydrate/i);
    expect(client.gmailServer.update).not.toHaveBeenCalled();
  });
});

describe('processHistoryDelta (real Pub/Sub notifications)', () => {
  const serverWithCursor = { ...server, lastHistoryId: '100' };

  beforeEach(() => {
    fakeService.getEmailMetadata.mockReset().mockResolvedValue({ ...hydratedMetadata });
    fakeService.getEmailContent.mockReset().mockResolvedValue({ body: 'body', truncated: false });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});
  });

  it('dispatches the delta and advances the cursor afterwards', async () => {
    fakeService.listHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);

    const result = await processHistoryDelta(serverWithCursor, '150', deps);

    expect(fakeService.listHistory).toHaveBeenCalledWith('100');
    expect(result).toMatchObject({ created: 1, cursorReset: false });
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('initializes the cursor without listing when none is stored (no ancient-mail flood)', async () => {
    const result = await processHistoryDelta({ ...server, lastHistoryId: null }, '150', deps);

    expect(fakeService.listHistory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, cursorReset: true });
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('resets the cursor when Gmail reports it too old (listHistory null)', async () => {
    fakeService.listHistory.mockResolvedValue(null);

    const result = await processHistoryDelta(serverWithCursor, '150', deps);

    expect(result).toMatchObject({ created: 0, cursorReset: true });
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('does NOT advance the cursor when hydration fails, so redelivery retries safely', async () => {
    fakeService.listHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);
    fakeService.getEmailMetadata.mockResolvedValue(null);

    await expect(processHistoryDelta(serverWithCursor, '150', deps)).rejects.toThrow(/hydrate/i);
    expect(client.gmailServer.update).not.toHaveBeenCalled();
  });
});

describe('shouldTrigger (hydrated filters)', () => {
  const payload = {
    from: 'Priya <Priya@example.com>',
    subject: 'Invoice 42 overdue',
    labels: ['INBOX'],
  };

  it('starred requires the STARRED label', async () => {
    const trigger = triggerRow({ triggerType: 'starred' });
    await expect(shouldTrigger(trigger, payload)).resolves.toBe(false);
    await expect(
      shouldTrigger(trigger, { ...payload, labels: ['INBOX', 'STARRED'] })
    ).resolves.toBe(true);
  });

  it('labeled matches metadata.targetLabels against hydrated labels', async () => {
    const trigger = triggerRow({
      triggerType: 'labeled',
      metadata: { targetLabels: ['BILLING'] },
    });
    await expect(shouldTrigger(trigger, payload)).resolves.toBe(false);
    await expect(
      shouldTrigger(trigger, { ...payload, labels: ['INBOX', 'BILLING'] })
    ).resolves.toBe(true);
  });

  it('unknown trigger types never fire', async () => {
    await expect(shouldTrigger(triggerRow({ triggerType: 'whatever' }), payload)).resolves.toBe(
      false
    );
  });
});

describe('event-type mapping', () => {
  it.each([
    ['new_email', 'new_email'],
    ['label_added', 'labeled'],
    ['label_removed', 'labeled'],
    ['starred', 'starred'],
    ['unstarred', 'starred'],
    ['moved', 'moved'],
    [undefined, 'new_email'],
    ['something_new', 'new_email'],
  ])('maps %s -> %s', (raw, expected) => {
    expect(mapGmailEventType(raw as any)).toBe(expected);
  });
});

describe('mapHistoryRecords (users.history.list -> trigger vocabulary)', () => {
  const msg = (id: string, labelIds?: string[]) => ({ message: { id }, labelIds });

  it('maps messageAdded/labelAdded/labelRemoved conservatively', () => {
    const events = mapHistoryRecords([
      { messagesAdded: [msg('m1')] },
      { labelsAdded: [msg('m2', ['STARRED']), msg('m3', ['BILLING'])] },
      { labelsRemoved: [msg('m4', ['INBOX']), msg('m5', ['UNREAD'])] },
    ]);

    expect(events).toEqual([
      { messageId: 'm1', eventType: 'new_email', rawEventType: 'messageAdded' },
      { messageId: 'm2', eventType: 'starred', rawEventType: 'labelAdded' },
      { messageId: 'm3', eventType: 'labeled', rawEventType: 'labelAdded' },
      { messageId: 'm4', eventType: 'moved', rawEventType: 'labelRemoved' },
      { messageId: 'm5', eventType: 'labeled', rawEventType: 'labelRemoved' },
    ]);
  });

  it('collapses duplicate message+type pairs within the batch and ignores malformed entries', () => {
    const events = mapHistoryRecords([
      { messagesAdded: [msg('m1'), msg('m1'), { message: {} }, null as any] },
      null as any,
      {},
    ]);
    expect(events).toEqual([
      { messageId: 'm1', eventType: 'new_email', rawEventType: 'messageAdded' },
    ]);
  });
});

describe('intake grilled additions (docs/ask-matt T1)', () => {
  beforeEach(() => {
    fakeService.getEmailMetadata.mockReset().mockResolvedValue({ ...hydratedMetadata });
    fakeService.getEmailContent.mockReset().mockResolvedValue({
      body: 'Please pay invoice 42 by Friday.',
      truncated: false,
      plain: 'Please pay invoice 42 by Friday.',
      html: '<p>Please pay invoice 42 by Friday.</p>',
    });
    fakeService.getAttachments.mockReset().mockResolvedValue([]);
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([server]);
  });

  it('hydrates attachment metadata + ≤5MB content into the run payload', async () => {
    fakeService.getEmailMetadata.mockResolvedValue({ ...hydratedMetadata, hasAttachments: true });
    fakeService.getAttachments.mockResolvedValue([
      {
        filename: 'inv.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        attachmentId: 'att-1',
        content: 'QUJD',
        contentEncoding: 'base64url',
      },
      {
        filename: 'huge.zip',
        mimeType: 'application/zip',
        size: 9 * 1024 * 1024,
        attachmentId: 'att-2',
        contentTruncated: true,
      },
    ]);
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);

    const result = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(result.runsEnqueued).toBe(1);
    expect(fakeService.getAttachments).toHaveBeenCalledWith('msg-1');
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    const payload = mockEnqueueRun.mock.calls[0][0].metadata;
    expect(payload.attachments).toHaveLength(2);
    expect(payload.attachments[0].content).toBe('QUJD');
    expect(payload.attachments[1].contentTruncated).toBe(true);
    expect(payload.bodyPlain).toContain('invoice 42');
    expect(payload.bodyHtml).toBe('<p>Please pay invoice 42 by Friday.</p>');
  });

  it('does not call getAttachments when the message has none', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    const result = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(result.runsEnqueued).toBe(1);
    expect(fakeService.getAttachments).not.toHaveBeenCalled();
  });

  it('fires a matching_search trigger row only on new_email ingress', async () => {
    const searchRow = triggerRow({
      triggerType: 'matching_search',
      metadata: { searchQuery: 'from:priya subject:invoice' },
    });

    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([searchRow]);
    const matched = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(matched.runsEnqueued).toBe(1);

    installIntakeFake();
    const relabeled = await intakeGmailDelivery(
      legacyDelivery({ messageId: 'msg-9', eventType: 'label_added' }),
      deps
    );
    expect(relabeled.runsEnqueued).toBe(0);
  });

  it('skips a matching_search row whose query does not match', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ triggerType: 'matching_search', metadata: { searchQuery: 'from:bob' } }),
    ]);
    const result = await intakeGmailDelivery(legacyDelivery(), deps);
    expect(result.runsEnqueued).toBe(0);
  });
});
