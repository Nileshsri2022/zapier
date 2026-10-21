import { matchesGmailQuery, tokenizeGmailQuery } from '../../src/services/gmailSearchQuery';

/**
 * Gmail Matching Search evaluator (docs/ask-matt/triggers/gmail.md E2,
 * grilled Q-GMAIL-01). Pure — hand-built payloads, no Google calls.
 */

const base = {
  from: 'Ada Lovelace <ada@example.com>',
  to: ['owner@example.com', 'billing@example.com'],
  subject: 'Invoice 42 overdue',
  labels: ['INBOX', 'UNREAD'],
  hasAttachments: true,
  isRead: false,
  snippet: 'Please pay invoice 42',
  body: 'Attached is invoice 42 for $12. Payment is due Friday.',
};

describe('tokenizeGmailQuery', () => {
  it('splits field, quoted-phrase and bare tokens', () => {
    expect(tokenizeGmailQuery('from:ada "payment due" invoice')).toEqual([
      { kind: 'field', field: 'from', value: 'ada' },
      { kind: 'text', value: 'payment due' },
      { kind: 'text', value: 'invoice' },
    ]);
  });

  it('supports quoted field values', () => {
    expect(tokenizeGmailQuery('subject:"Invoice 42 overdue"')).toEqual([
      { kind: 'field', field: 'subject', value: 'Invoice 42 overdue' },
    ]);
  });
});

describe('matchesGmailQuery', () => {
  it('never matches an empty or whitespace query', () => {
    expect(matchesGmailQuery('', base)).toBe(false);
    expect(matchesGmailQuery('   ', base)).toBe(false);
  });

  it('matches from: case-insensitively as substring', () => {
    expect(matchesGmailQuery('from:ada@example.com', base)).toBe(true);
    expect(matchesGmailQuery('from:bob@example.com', base)).toBe(false);
  });

  it('matches to: against any recipient', () => {
    expect(matchesGmailQuery('to:billing', base)).toBe(true);
    expect(matchesGmailQuery('to:nobody', base)).toBe(false);
  });

  it('matches subject: as substring', () => {
    expect(matchesGmailQuery('subject:invoice', base)).toBe(true);
    expect(matchesGmailQuery('subject:refund', base)).toBe(false);
  });

  it('matches label: exactly, case-insensitively', () => {
    expect(matchesGmailQuery('label:inbox', base)).toBe(true);
    expect(matchesGmailQuery('label:IMPORTANT', base)).toBe(false);
  });

  it('matches has:attachment', () => {
    expect(matchesGmailQuery('has:attachment', base)).toBe(true);
    expect(matchesGmailQuery('has:attachment', { ...base, hasAttachments: false })).toBe(false);
  });

  it('matches is:starred / is:unread / is:read', () => {
    expect(matchesGmailQuery('is:unread', base)).toBe(true);
    expect(matchesGmailQuery('is:read', base)).toBe(false);
    expect(matchesGmailQuery('is:starred', base)).toBe(false);
    expect(matchesGmailQuery('is:starred', { ...base, labels: ['INBOX', 'STARRED'] })).toBe(true);
    expect(matchesGmailQuery('is:read', { ...base, isRead: true })).toBe(true);
  });

  it('ANDs multiple tokens (all must match)', () => {
    expect(matchesGmailQuery('from:ada subject:invoice', base)).toBe(true);
    expect(matchesGmailQuery('from:ada subject:refund', base)).toBe(false);
  });

  it('matches bare terms and quoted phrases across subject/from/snippet/body', () => {
    expect(matchesGmailQuery('"payment is due"', base)).toBe(true);
    expect(matchesGmailQuery('friday', base)).toBe(true);
    expect(matchesGmailQuery('vacation', base)).toBe(false);
  });

  it('treats unknown operators as text, still AND-ed', () => {
    expect(matchesGmailQuery('cc:someone', base)).toBe(false);
  });

  it('matches a realistic grilled query end-to-end', () => {
    const q = 'from:ada@example.com subject:invoice has:attachment is:unread';
    expect(matchesGmailQuery(q, base)).toBe(true);
    expect(matchesGmailQuery(q, { ...base, isRead: true })).toBe(false);
  });
});
