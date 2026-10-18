import { extractEmailBody, GMAIL_BODY_MAX_CHARS } from '../../src/services/GmailService';

/**
 * Plain-text extraction from Gmail `format: 'full'` payloads.
 * Pure function — fixtures are hand-built payload trees, no Google calls.
 */

const b64url = (text: string) =>
  Buffer.from(text, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const part = (mimeType: string, text: string, extra: any = {}) => ({
  mimeType,
  body: { data: b64url(text) },
  ...extra,
});

describe('extractEmailBody', () => {
  it('decodes a single-part text/plain payload', () => {
    const payload = part('text/plain', 'Hello from a single-part email.');
    expect(extractEmailBody(payload)).toEqual({
      body: 'Hello from a single-part email.',
      truncated: false,
    });
  });

  it('prefers text/plain over text/html in multipart/alternative trees', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', 'Plain version'), part('text/html', '<p>HTML version</p>')],
    };
    expect(extractEmailBody(payload).body).toBe('Plain version');
  });

  it('walks nested multipart trees', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [part('text/plain', 'Nested plain text')],
        },
      ],
    };
    expect(extractEmailBody(payload).body).toBe('Nested plain text');
  });

  it('falls back to stripped HTML when no plain part exists', () => {
    const payload = part(
      'text/html',
      '<html><head><style>p{color:red}</style></head><body><script>evil()</script><p>Pay &amp; go</p></body></html>'
    );
    const { body } = extractEmailBody(payload);
    expect(body).toContain('Pay & go');
    expect(body).not.toContain('evil');
    expect(body).not.toContain('<p>');
  });

  it('never inlines attachment parts', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        part('text/plain', 'See attached.'),
        part('text/plain', 'SECRET ATTACHMENT BYTES', { filename: 'note.txt' }),
      ],
    };
    const { body } = extractEmailBody(payload);
    expect(body).toBe('See attached.');
    expect(body).not.toContain('SECRET');
  });

  it('caps at GMAIL_BODY_MAX_CHARS and flags truncation', () => {
    const payload = part('text/plain', 'x'.repeat(GMAIL_BODY_MAX_CHARS + 500));
    const result = extractEmailBody(payload);
    expect(result.truncated).toBe(true);
    expect(result.body).toHaveLength(GMAIL_BODY_MAX_CHARS);
  });

  it('returns empty body for missing/empty payloads', () => {
    expect(extractEmailBody(null)).toEqual({ body: '', truncated: false });
    expect(extractEmailBody(undefined)).toEqual({ body: '', truncated: false });
    expect(extractEmailBody({ mimeType: 'multipart/mixed', parts: [] })).toEqual({
      body: '',
      truncated: false,
    });
  });
});
