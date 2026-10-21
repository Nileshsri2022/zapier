import client from '@repo/db';

/**
 * Gmail trigger dispatch (reports/gmail-worker-routing-spec.md, P2).
 *
 * GmailService is mocked at the module boundary — no test ever calls
 * Google. Run intake is replaced with a stateful in-memory fake that
 * reproduces its documented result contract (first-seen key enqueues,
 * replay is a duplicate). The durable transaction itself is covered once,
 * in packages/runs/tests/intake.test.ts.
 */

const mockGetEmailMetadata = jest.fn();
const mockGetEmailContent = jest.fn();
const mockGetAttachments = jest.fn();
const mockListHistory = jest.fn();
const mockWatchEmails = jest.fn();
const mockGetProfileEmail = jest.fn();
jest.mock('../../src/services/GmailService', () => ({
  GmailService: jest.fn().mockImplementation(() => ({
    getEmailMetadata: mockGetEmailMetadata,
    getEmailContent: mockGetEmailContent,
    getAttachments: mockGetAttachments,
    getProfileEmail: mockGetProfileEmail,
    listHistory: mockListHistory,
    watchEmails: mockWatchEmails,
  })),
}));

const mockEnqueueSeen = new Set<string>();
const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

const installIntakeFake = () => {
  mockEnqueueSeen.clear();
  mockEnqueueRun.mockReset();
  mockEnqueueRun.mockImplementation(async (input: any) => {
    const key = input.dedup?.key;
    if (key && mockEnqueueSeen.has(key)) {
      return { status: 'duplicate' };
    }
    if (key) mockEnqueueSeen.add(key);
    return { status: 'queued', zapRunId: 'run-1', dispatched: true };
  });
};

import {
  dispatchGmailEvent,
  shouldTrigger,
  mapGmailEventType,
  mapHistoryRecords,
  processHistoryDelta,
  renewExpiringGmailWatches,
  pollActiveGmailServers,
} from '../../src/services/GmailDispatch';
import { processGmailTrigger } from '../../src/controllers/GmailTriggersController';

const server = {
  id: 'server-1',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  refreshToken: 'refresh-token',
  accessToken: 'access-token',
  tokenExpiry: null,
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

describe('GmailDispatch.dispatchGmailEvent', () => {
  beforeEach(() => {
    installIntakeFake();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({
      body: 'Please pay invoice 42 by Friday.',
      truncated: false,
    });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
  });

  it('hands the §4.3 payload to run intake with a Zap+message+event dedup key', async () => {
    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0 });
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

  it('hydrates once even when several Zaps match', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow(),
      triggerRow({ zap: { id: 'zap-2', isActive: true } }),
    ]);

    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result.created).toBe(2);
    expect(mockGetEmailMetadata).toHaveBeenCalledTimes(1);
    expect(mockGetEmailContent).toHaveBeenCalledTimes(1);
  });

  it('counts an inactive-Zap decision from intake as skipped', async () => {
    mockEnqueueRun.mockResolvedValue({ status: 'skipped', reason: 'zap_inactive' });

    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('applies sender/subject filters against the hydrated payload (audit B4)', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ senderFilter: 'someone-else' }),
    ]);
    let result = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(result.created).toBe(0);

    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ senderFilter: 'Priya', subjectFilter: 'invoice' }),
    ]);
    result = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(result.created).toBe(1);
  });

  it('dedups a redelivered event per Zap+message+event, but a later star still fires', async () => {
    const first = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    const replay = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(first.created).toBe(1);
    expect(replay).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);

    // Same message, different event kind = legitimate second run.
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ triggerType: 'starred' }),
    ]);
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata, labels: ['INBOX', 'STARRED'] });
    const starred = await dispatchGmailEvent(server, 'msg-1', 'starred');
    expect(starred.created).toBe(1);
  });

  it('throws with zero rows written when hydration fails', async () => {
    mockGetEmailMetadata.mockResolvedValue(null);

    await expect(dispatchGmailEvent(server, 'msg-1', 'new_email')).rejects.toThrow(
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

    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result).toEqual({ created: 1, skipped: 0, failed: 1 });
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

describe('GmailTriggersController.processGmailTrigger (outbox dispatch)', () => {
  beforeEach(() => {
    installIntakeFake();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({ body: 'body', truncated: false });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    (client.zap.findUnique as jest.Mock).mockResolvedValue(null); // legacy executor no-ops
  });

  it('resolves the server and enqueues via dispatch', async () => {
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(server);

    await processGmailTrigger('server-1', { id: 'msg-1', eventType: 'new_email' });

    expect(client.gmailServer.findUnique).toHaveBeenCalledWith({ where: { id: 'server-1' } });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('unresolvable identifier is a logged no-op', async () => {
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(null);
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      processGmailTrigger('nobody@gmail.com', { id: 'msg-1', eventType: 'new_email' })
    ).resolves.toBeUndefined();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('falls back to GmailServer.email resolution (P3/B3)', async () => {
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(null);
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([server]);

    await processGmailTrigger('owner@gmail.com', { id: 'msg-1', eventType: 'new_email' });

    expect(client.gmailServer.findMany).toHaveBeenCalledWith({
      where: { email: 'owner@gmail.com', isActive: true },
    });
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
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

describe('processHistoryDelta (real Pub/Sub notifications)', () => {
  const serverWithCursor = { ...server, lastHistoryId: '100' };

  beforeEach(() => {
    installIntakeFake();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({ body: 'body', truncated: false });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});
  });

  it('dispatches the delta and advances the cursor afterwards', async () => {
    mockListHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);

    const result = await processHistoryDelta(serverWithCursor, '150');

    expect(mockListHistory).toHaveBeenCalledWith('100');
    expect(result).toMatchObject({ created: 1, cursorReset: false });
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('initializes the cursor without listing when none is stored (no ancient-mail flood)', async () => {
    const result = await processHistoryDelta({ ...server, lastHistoryId: null }, '150');

    expect(mockListHistory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ created: 0, cursorReset: true });
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('resets the cursor when Gmail reports it too old (listHistory null)', async () => {
    mockListHistory.mockResolvedValue(null);

    const result = await processHistoryDelta(serverWithCursor, '150');

    expect(result).toMatchObject({ created: 0, cursorReset: true });
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'server-1' },
      data: { lastHistoryId: '150' },
    });
  });

  it('does NOT advance the cursor when hydration fails, so redelivery retries safely', async () => {
    mockListHistory.mockResolvedValue([{ messagesAdded: [{ message: { id: 'msg-1' } }] }]);
    mockGetEmailMetadata.mockResolvedValue(null);

    await expect(processHistoryDelta(serverWithCursor, '150')).rejects.toThrow(/hydrate/i);
    expect(client.gmailServer.update).not.toHaveBeenCalled();
  });
});

describe('renewExpiringGmailWatches', () => {
  const now = new Date('2026-10-19T00:00:00.000Z');
  const watchServer = (id: string, expiry: Date | null, extra: any = {}) => ({
    ...server,
    id,
    lastHistoryId: '100',
    watchHistory: expiry ? [{ expiry, isActive: true, createdAt: now }] : [],
    ...extra,
  });

  beforeEach(() => {
    (client as any).gmailWatch = { create: jest.fn().mockResolvedValue({}) };
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});
    mockWatchEmails.mockResolvedValue({
      watchId: '555',
      expiry: new Date('2026-10-26T00:00:00.000Z'),
    });
  });

  it('renews only watches expiring within 24h (or missing) and records them', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      watchServer('soon', new Date('2026-10-19T12:00:00.000Z')),
      watchServer('fine', new Date('2026-10-25T00:00:00.000Z')),
      watchServer('none', null, { lastHistoryId: null }),
    ]);

    const result = await renewExpiringGmailWatches(now);

    expect(result).toEqual({ renewed: 2, failed: 0, checked: 3 });
    expect(mockWatchEmails).toHaveBeenCalledTimes(2);
    expect((client as any).gmailWatch.create).toHaveBeenCalledTimes(2);
    // Cursor initialized only where unset — never reset (would skip deltas).
    expect(client.gmailServer.update).toHaveBeenCalledTimes(1);
    expect(client.gmailServer.update).toHaveBeenCalledWith({
      where: { id: 'none' },
      data: { lastHistoryId: '555' },
    });
  });

  it('counts per-server failures without aborting the sweep', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      watchServer('bad', null),
      watchServer('good', null),
    ]);
    mockWatchEmails
      .mockRejectedValueOnce(new Error('watch rejected'))
      .mockResolvedValue({ watchId: '556', expiry: new Date('2026-10-26T00:00:00.000Z') });

    const result = await renewExpiringGmailWatches(now);
    expect(result).toEqual({ renewed: 1, failed: 1, checked: 2 });
  });
});

describe('GmailDispatch grilled additions (docs/ask-matt T1)', () => {
  beforeEach(() => {
    installIntakeFake();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({
      body: 'Please pay invoice 42 by Friday.',
      truncated: false,
      plain: 'Please pay invoice 42 by Friday.',
      html: '<p>Please pay invoice 42 by Friday.</p>',
    });
    mockGetAttachments.mockResolvedValue([]);
  });

  it('hydrates attachment metadata + ≤5MB content into the run payload', async () => {
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata, hasAttachments: true });
    mockGetAttachments.mockResolvedValue([
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

    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(result.created).toBe(1);
    expect(mockGetAttachments).toHaveBeenCalledWith('msg-1');
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
    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(result.created).toBe(1);
    expect(mockGetAttachments).not.toHaveBeenCalled();
  });

  it('fires a matching_search trigger row only on new_email ingress', async () => {
    const searchRow = triggerRow({
      triggerType: 'matching_search',
      metadata: { searchQuery: 'from:priya subject:invoice' },
    });

    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([searchRow]);
    const matched = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(matched.created).toBe(1);

    installIntakeFake();
    const relabeled = await dispatchGmailEvent(server, 'msg-9', 'labeled');
    expect(relabeled.created).toBe(0);
    expect(relabeled.skipped).toBe(1);
  });

  it('skips a matching_search row whose query does not match', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ triggerType: 'matching_search', metadata: { searchQuery: 'from:bob' } }),
    ]);
    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

describe('GmailDispatch.pollActiveGmailServers (polling fallback)', () => {
  beforeEach(() => {
    installIntakeFake();
  });

  it('processes the delta only when the profile historyId advanced', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([{ ...server, lastHistoryId: '100' }]);
    mockGetProfileEmail.mockResolvedValue({ email: 'a@b.c', historyId: '200' });
    mockListHistory.mockResolvedValue([]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});

    const result = await pollActiveGmailServers();
    expect(result.polled).toBe(1);
    expect(result.failedServers).toBe(0);
    expect(mockListHistory).toHaveBeenCalledWith('100');
  });

  it('skips servers whose cursor already matches the profile', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([{ ...server, lastHistoryId: '100' }]);
    mockGetProfileEmail.mockResolvedValue({ email: 'a@b.c', historyId: '100' });

    const result = await pollActiveGmailServers();
    expect(result.polled).toBe(0);
    expect(mockListHistory).not.toHaveBeenCalled();
  });

  it('counts per-server failures without aborting the sweep', async () => {
    (client.gmailServer.findMany as jest.Mock).mockResolvedValue([
      { ...server, id: 'bad', lastHistoryId: '1' },
      { ...server, id: 'good', lastHistoryId: '1' },
    ]);
    mockGetProfileEmail
      .mockRejectedValueOnce(new Error('profile down'))
      .mockResolvedValue({ email: 'a@b.c', historyId: '2' });
    mockListHistory.mockResolvedValue([]);
    (client.gmailServer.update as jest.Mock).mockResolvedValue({});

    const result = await pollActiveGmailServers();
    expect(result.failedServers).toBe(1);
    expect(result.polled).toBe(1);
  });
});
