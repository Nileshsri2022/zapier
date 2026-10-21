import { buildGmailRunPayload, shouldTrigger } from '../../src/services/gmailIntake';

/**
 * Gmail Matching Search trigger + grilled payload contract additions
 * (docs/ask-matt/triggers/gmail.md: E1-E3, Q-GMAIL-03 bodyPlain/bodyHtml,
 * Q-GMAIL-04 attachments). shouldTrigger and buildGmailRunPayload are
 * pure/async-pure — no DB, no Google.
 */

const metadata = {
  id: 'msg-1',
  threadId: 'thread-1',
  snippet: 'Please pay invoice 42',
  from: 'Ada Lovelace <ada@example.com>',
  to: ['owner@example.com'],
  subject: 'Invoice 42 overdue',
  date: new Date('2026-10-19T10:00:00.000Z'),
  labels: ['INBOX', 'UNREAD'],
  hasAttachments: true,
  isRead: false,
} as any;

const newEmailPayload = {
  ...metadata,
  eventType: 'new_email',
  body: 'Attached is invoice 42.',
};

describe('shouldTrigger — matching_search', () => {
  const searchTrigger = (searchQuery: any) => ({
    triggerType: 'matching_search',
    watchedLabels: [],
    senderFilter: null,
    subjectFilter: null,
    metadata: { searchQuery },
  });

  it('fires for a matching new email', async () => {
    await expect(
      shouldTrigger(searchTrigger('from:ada@example.com subject:invoice'), newEmailPayload)
    ).resolves.toBe(true);
  });

  it('does not fire when the query does not match', async () => {
    await expect(
      shouldTrigger(searchTrigger('from:bob@example.com'), newEmailPayload)
    ).resolves.toBe(false);
  });

  it('never fires without a query (no whole-mailbox fan-out)', async () => {
    await expect(shouldTrigger(searchTrigger(undefined), newEmailPayload)).resolves.toBe(false);
    await expect(shouldTrigger(searchTrigger('   '), newEmailPayload)).resolves.toBe(false);
    await expect(
      shouldTrigger({ ...searchTrigger('anything'), metadata: {} }, newEmailPayload)
    ).resolves.toBe(false);
  });

  it('does not re-fire on later label/star events of an old matching email', async () => {
    for (const eventType of ['labeled', 'starred', 'moved']) {
      await expect(
        shouldTrigger(searchTrigger('subject:invoice'), { ...newEmailPayload, eventType })
      ).resolves.toBe(false);
    }
  });

  it('unknown trigger types still return false', async () => {
    await expect(
      shouldTrigger({ triggerType: 'nope', metadata: {} }, newEmailPayload)
    ).resolves.toBe(false);
  });
});

describe('buildGmailRunPayload — grilled contract additions', () => {
  it('carries bodyPlain/bodyHtml and attachments alongside legacy body', () => {
    const payload = buildGmailRunPayload(
      metadata,
      {
        body: 'plain derived',
        truncated: false,
        plain: 'plain text',
        html: '<p>html body</p>',
        attachments: [
          {
            filename: 'inv.pdf',
            mimeType: 'application/pdf',
            size: 1234,
            attachmentId: 'att-1',
            content: 'QUJD',
            contentEncoding: 'base64url',
          },
        ],
      },
      'new_email',
      'server-1'
    );

    expect(payload.body).toBe('plain derived');
    expect(payload.bodyPlain).toBe('plain text');
    expect(payload.bodyHtml).toBe('<p>html body</p>');
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0].filename).toBe('inv.pdf');
    expect(payload.attachments[0].content).toBe('QUJD');
    expect(payload.hasAttachments).toBe(true);
    expect(payload.serverId).toBe('server-1');
  });

  it('defaults gracefully when parts/attachments are absent (compat path)', () => {
    const payload = buildGmailRunPayload(
      metadata,
      { body: 'only legacy', truncated: false },
      'new_email',
      'server-1'
    );
    expect(payload.bodyPlain).toBe('only legacy');
    expect(payload.bodyHtml).toBeNull();
    expect(payload.attachments).toEqual([]);
  });

  it('flags oversized bodies as truncated on both plain and legacy fields', () => {
    const payload = buildGmailRunPayload(
      metadata,
      { body: 'cut', truncated: true, plain: 'cut', html: 'cut', attachments: [] },
      'new_email',
      'server-1'
    );
    expect(payload.bodyTruncated).toBe(true);
  });
});
