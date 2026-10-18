import client from '@repo/db';

/**
 * Gmail outbox dispatch (reports/gmail-worker-routing-spec.md, P2).
 *
 * GmailService is mocked at the module boundary — no test ever calls
 * Google. The dedup helper is replaced with a stateful in-memory fake
 * with the same first-seen/duplicate contract as the Redis SET NX one.
 */

const mockGetEmailMetadata = jest.fn();
const mockGetEmailContent = jest.fn();
jest.mock('../../src/services/GmailService', () => ({
  GmailService: jest.fn().mockImplementation(() => ({
    getEmailMetadata: mockGetEmailMetadata,
    getEmailContent: mockGetEmailContent,
  })),
}));

const mockDedupSeen = new Set<string>();
const mockIsDuplicateEvent = jest.fn(async (scope: string, eventId: string) => {
  const key = `${scope}:${eventId}`;
  if (mockDedupSeen.has(key)) return true;
  mockDedupSeen.add(key);
  return false;
});
jest.mock('../../src/utils/dedup', () => ({
  isDuplicateEvent: (scope: string, eventId: string) => mockIsDuplicateEvent(scope, eventId),
  dedupKey: (scope: string, eventId: string) => `zapmate:dedup:${scope}:${eventId}`,
}));

import {
  dispatchGmailEvent,
  shouldTrigger,
  mapGmailEventType,
  gmailExecutionPath,
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
    mockDedupSeen.clear();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({
      body: 'Please pay invoice 42 by Friday.',
      truncated: false,
    });
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(client));
    (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-1' });
    (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({ id: 'outbox-1' });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
  });

  afterEach(() => {
    delete process.env.GMAIL_EXECUTION_PATH;
  });

  it('enqueues ZapRun + ZapRunOutbox in one transaction with the §4.3 payload contract', async () => {
    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result).toEqual({ created: 1, skipped: 0, failed: 0 });
    expect(client.$transaction).toHaveBeenCalledTimes(1);

    const runArg = (client.zapRun.create as jest.Mock).mock.calls[0][0];
    expect(runArg.data.zapId).toBe('zap-1');
    expect(runArg.data.metadata).toMatchObject({
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
    expect(typeof runArg.data.metadata.timestamp).toBe('string');

    expect(client.zapRunOutbox.create).toHaveBeenCalledWith({ data: { zapRunId: 'run-1' } });
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

  it('skips inactive Zaps without writing rows', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow({ zap: { id: 'zap-off', isActive: false } }),
    ]);

    const result = await dispatchGmailEvent(server, 'msg-1', 'new_email');

    expect(result).toEqual({ created: 0, skipped: 1, failed: 0 });
    expect(client.zapRun.create).not.toHaveBeenCalled();
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
    expect(client.zapRun.create).toHaveBeenCalledTimes(1);

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
    expect(client.zapRun.create).not.toHaveBeenCalled();
    expect(client.gmailTrigger.findMany).not.toHaveBeenCalled();
  });

  it('one failing Zap does not block its siblings', async () => {
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([
      triggerRow(),
      triggerRow({ zap: { id: 'zap-2', isActive: true } }),
    ]);
    (client.zapRun.create as jest.Mock)
      .mockRejectedValueOnce(new Error('db write failed'))
      .mockResolvedValue({ id: 'run-2' });

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

describe('event-type mapping + execution-path switch', () => {
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

  it('defaults to inline unless GMAIL_EXECUTION_PATH=outbox', () => {
    delete process.env.GMAIL_EXECUTION_PATH;
    expect(gmailExecutionPath()).toBe('inline');
    process.env.GMAIL_EXECUTION_PATH = 'inline';
    expect(gmailExecutionPath()).toBe('inline');
    process.env.GMAIL_EXECUTION_PATH = 'outbox';
    expect(gmailExecutionPath()).toBe('outbox');
    delete process.env.GMAIL_EXECUTION_PATH;
  });
});

describe('GmailTriggersController.processGmailTrigger routing (D6 switch)', () => {
  beforeEach(() => {
    mockDedupSeen.clear();
    mockGetEmailMetadata.mockResolvedValue({ ...hydratedMetadata });
    mockGetEmailContent.mockResolvedValue({ body: 'body', truncated: false });
    (client.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(client));
    (client.zapRun.create as jest.Mock).mockResolvedValue({ id: 'run-1' });
    (client.zapRunOutbox.create as jest.Mock).mockResolvedValue({ id: 'outbox-1' });
    (client.gmailTrigger.findMany as jest.Mock).mockResolvedValue([triggerRow()]);
    (client.zap.findUnique as jest.Mock).mockResolvedValue(null); // legacy executor no-ops
  });

  afterEach(() => {
    delete process.env.GMAIL_EXECUTION_PATH;
  });

  it('outbox mode: resolves the server and enqueues via dispatch', async () => {
    process.env.GMAIL_EXECUTION_PATH = 'outbox';
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(server);

    await processGmailTrigger('server-1', { id: 'msg-1', eventType: 'new_email' });

    expect(client.gmailServer.findUnique).toHaveBeenCalledWith({ where: { id: 'server-1' } });
    expect(client.zapRun.create).toHaveBeenCalled();
    expect(client.zapRunOutbox.create).toHaveBeenCalled();
  });

  it('outbox mode: unresolvable server id is a logged no-op (email resolution is P3)', async () => {
    process.env.GMAIL_EXECUTION_PATH = 'outbox';
    (client.gmailServer.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(
      processGmailTrigger('owner@gmail.com', { id: 'msg-1', eventType: 'new_email' })
    ).resolves.toBeUndefined();
    expect(client.zapRun.create).not.toHaveBeenCalled();
  });

  it('inline mode (default): legacy fan-out, no outbox writes', async () => {
    delete process.env.GMAIL_EXECUTION_PATH;

    await processGmailTrigger('server-1', { id: 'msg-1', eventType: 'new_email' });

    expect(client.gmailServer.findUnique).not.toHaveBeenCalled();
    expect(client.gmailTrigger.findMany).toHaveBeenCalledWith({
      where: { serverId: 'server-1' },
      include: { zap: true },
    });
    expect(client.zapRunOutbox.create).not.toHaveBeenCalled();
    expect(mockGetEmailMetadata).not.toHaveBeenCalled();
  });
});
