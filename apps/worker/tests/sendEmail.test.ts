import {
  ATTACHMENT_MAX_BYTES,
  EmailActionError,
  buildMime,
  fetchAttachment,
  parseEmailInput,
  sendEmailAction,
} from '../src/sendEmail';

/**
 * A2 spec acceptance (docs/ask-matt/actions/email.md, grilled round 12).
 * Q-EMAIL-01 Gmail API via shared connection · Q-EMAIL-02 full field set ·
 * Q-EMAIL-03 multipart plain+HTML · Q-EMAIL-04 URL attachments ≤5 MB
 * fail-closed · Q-EMAIL-05 from constrained to owned identities.
 */

const RUN = { userId: 42, previousOutput: { fields: { name: 'Ada' } } };

const server = {
  id: 'srv-1',
  email: 'owner@example.com',
  clientId: 'cid',
  clientSecret: 'csecret',
  refreshToken: 'rtoken',
  accessToken: 'ya29.valid',
  tokenExpiry: new Date(Date.now() + 3600_000),
};

const validMeta = () => ({
  to: 'ada@example.com',
  subject: 'Weekly digest — wk 43',
  bodyPlain: 'Hi {{previousOutput.fields.name}}, weekly digest',
  fromEmail: 'owner@example.com',
});

function makeDb(overrides: Record<string, any> = {}) {
  return {
    gmailServer: {
      findFirst: jest.fn(async () => server),
      update: jest.fn(async () => server),
    },
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (key: string) => init.headers?.[key.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: undefined,
  } as unknown as Response;
}

describe('validation (spec §4/§6): nothing is sent', () => {
  it('templates recipients/subject/body and returns the §4 output contract', async () => {
    const parsed = parseEmailInput(
      { ...validMeta(), to: '{{previousOutput.fields.name}}@example.com' },
      { previousOutput: { fields: { name: 'Ada' } } }
    );
    expect(parsed.to).toEqual(['Ada@example.com']);
    expect(parsed.bodyPlain).toContain('Hi Ada');
  });

  it('requires at least one valid recipient', async () => {
    expect(() => parseEmailInput({ ...validMeta(), to: '' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() => parseEmailInput({ ...validMeta(), to: 'not-an-email' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
  });

  it('requires bodyPlain (legacy `body` accepted) and subject', async () => {
    expect(() => parseEmailInput({ ...validMeta(), bodyPlain: '' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() => parseEmailInput({ ...validMeta(), subject: '' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    const legacy = parseEmailInput({ to: 'a@b.co', subject: 's', body: 'legacy body' }, RUN);
    expect(legacy.bodyPlain).toBe('legacy body');
  });

  it('rejects header injection in subject/fromName', () => {
    expect(() => parseEmailInput({ ...validMeta(), subject: 'x\r\nBcc: evil@bad.co' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() => parseEmailInput({ ...validMeta(), fromName: 'a\nBcc: x@y.co' }, RUN)).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
  });

  it('never calls the provider when validation fails', async () => {
    const fetchImpl = jest.fn();
    await expect(
      sendEmailAction({ ...validMeta(), to: 'bad@@' }, RUN, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        db: makeDb() as any,
      })
    ).rejects.toMatchObject({ code: 'validation' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Q-EMAIL-03 multipart bodies', () => {
  it('sends plain only when no HTML is given', () => {
    const input = parseEmailInput(validMeta(), RUN);
    const mime = buildMime(input, 'owner@example.com', []);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).not.toContain('multipart/alternative');
    // Non-ASCII subject is RFC 2047 encoded (em dash in the fixture).
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
  });

  it('passes an ASCII subject through verbatim', () => {
    const input = parseEmailInput({ ...validMeta(), subject: 'Weekly digest' }, RUN);
    expect(buildMime(input, 'owner@example.com', [])).toContain('Subject: Weekly digest');
  });

  it('builds multipart/alternative when bodyHtml is present', () => {
    const input = parseEmailInput({ ...validMeta(), bodyHtml: '<p>Hi</p>' }, RUN);
    const mime = buildMime(input, 'owner@example.com', []);
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('<p>Hi</p>');
    expect(mime).toContain('text/plain');
  });

  it('adds Cc/Bcc/Reply-To/From display name and RFC2047-encodes unicode subjects', () => {
    const input = parseEmailInput(
      {
        ...validMeta(),
        cc: 'lead@example.com',
        bcc: 'audit@example.com',
        replyTo: 'support@example.com',
        fromName: 'ZapMate Digests',
        subject: 'साप्ताहिक सारांश',
      },
      RUN
    );
    const mime = buildMime(input, 'digests@example.com', []);
    expect(mime).toContain('Cc: lead@example.com');
    expect(mime).toContain('Bcc: audit@example.com');
    expect(mime).toContain('Reply-To: support@example.com');
    expect(mime).toContain('"ZapMate Digests" <digests@example.com>');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
  });
});

describe('Q-EMAIL-04 attachments: ≤5 MB, fail closed', () => {
  const bodyOf = (bytes: number) =>
    ({
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new Uint8Array(bytes) };
          },
          cancel: async () => {},
        };
      },
    }) as any;

  it('fetches and base64-encodes a small attachment, guessing mime from filename', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: bodyOf(16),
    }));
    const attachment = await fetchAttachment(
      'https://files.example.com/report.pdf',
      '',
      fetchImpl as unknown as typeof fetch
    );
    expect(attachment.filename).toBe('report.pdf');
    expect(attachment.mimeType).toBe('application/pdf');
    expect(attachment.data.length).toBeGreaterThan(0);
  });

  it('fails when the URL is unreachable', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      fetchAttachment('https://nope.example.com/x.pdf', '', fetchImpl as unknown as typeof fetch)
    ).rejects.toMatchObject({ code: 'attachment_fetch_failed' });
  });

  it('fails when the declared or streamed size exceeds 5 MB', async () => {
    const declared = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (key: string) => (key.toLowerCase() === 'content-length' ? String(ATTACHMENT_MAX_BYTES + 1) : null) },
      body: bodyOf(8),
    }));
    await expect(
      fetchAttachment('https://files.example.com/big.pdf', '', declared as unknown as typeof fetch)
    ).rejects.toMatchObject({ code: 'attachment_fetch_failed' });

    const streamed = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: bodyOf(ATTACHMENT_MAX_BYTES + 1),
    }));
    await expect(
      fetchAttachment('https://files.example.com/big2.pdf', '', streamed as unknown as typeof fetch)
    ).rejects.toMatchObject({ code: 'attachment_fetch_failed' });
  });

  it('fails the run (no send) when any attachment fails', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('files.example.com')) throw new Error('timeout');
      throw new Error('unexpected');
    });
    await expect(
      sendEmailAction(
        { ...validMeta(), attachments: [{ url: 'https://files.example.com/missing.pdf' }] },
        RUN,
        { fetchImpl: fetchImpl as unknown as typeof fetch, db: makeDb() as any }
      )
    ).rejects.toMatchObject({ code: 'attachment_fetch_failed' });
    const sendCalls = fetchImpl.mock.calls.filter(([url]) => String(url).includes('messages/send'));
    expect(sendCalls).toHaveLength(0);
  });

  it('attaches files as multipart/mixed parts', () => {
    const input = parseEmailInput(validMeta(), RUN);
    const mime = buildMime(input, 'owner@example.com', [
      { url: 'https://x/y.pdf', filename: 'y.pdf', mimeType: 'application/pdf', data: 'QQ==' },
    ]);
    expect(mime).toContain('multipart/mixed');
    expect(mime).toContain('Content-Disposition: attachment; filename="y.pdf"');
  });
});

describe('send path, from policy and error classes', () => {
  it('sends via Gmail API and returns sent/messageId/accepted (§4)', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ id: 'CAQR7abc' }));
    const out = await sendEmailAction(validMeta(), RUN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      db: makeDb() as any,
      now: () => 1_700_000_000_000,
    });
    expect(out.sent).toBe(true);
    expect(out.messageId).toBe('CAQR7abc');
    expect(out.accepted).toEqual(['ada@example.com']);
    expect(out.rejected).toEqual([]);
    expect(out.provider).toBe('gmail-api');
    expect(out.sentAt).toBe(new Date(1_700_000_000_000).toISOString());
    // legacy template aliases
    expect(out.to).toBe('ada@example.com');
    expect(out.subject).toContain('Weekly digest');

    const [url, init] = fetchImpl.mock.calls[0] as [string, any];
    expect(url).toContain('/gmail/v1/users/me/messages/send');
    expect(init.headers.Authorization).toBe('Bearer ya29.valid');
    expect(JSON.parse(init.body).raw).not.toContain('+');
  });

  it('defaults from to the connected mailbox and accepts a verified alias', async () => {
    const aliasFetch = jest.fn(async (url: string) => {
      if (String(url).includes('settings/sendAs'))
        return jsonResponse({ sendAs: [{ sendAsEmail: 'digests@example.com', verified: true }] });
      return jsonResponse({ id: 'id-1' });
    });
    const out = await sendEmailAction({ ...validMeta(), fromEmail: 'digests@example.com' }, RUN, {
      fetchImpl: aliasFetch as unknown as typeof fetch,
      db: makeDb() as any,
    });
    expect(out.sent).toBe(true);

    const defaultFetch = jest.fn(async () => jsonResponse({ id: 'id-2' }));
    const { fromEmail, ...noFrom } = validMeta();
    await expect(
      sendEmailAction(noFrom, RUN, {
        fetchImpl: defaultFetch as unknown as typeof fetch,
        db: makeDb() as any,
      })
    ).resolves.toMatchObject({ sent: true });
    const send = (defaultFetch.mock.calls[0] as [string, any])[1].body;
    const decoded = Buffer.from(JSON.parse(send).raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
    expect(decoded).toContain('owner@example.com');
  });

  it('Q-EMAIL-05: from-address the account does not own → from_not_allowed, nothing sent', async () => {
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('settings/sendAs'))
        return jsonResponse({ sendAs: [{ sendAsEmail: 'owner@example.com', verified: true }] });
      return jsonResponse({ id: 'should-not-happen' });
    });
    await expect(
      sendEmailAction({ ...validMeta(), fromEmail: 'someone@other.com' }, RUN, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        db: makeDb() as any,
      })
    ).rejects.toMatchObject({ code: 'from_not_allowed' });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('messages/send'))).toBe(false);
  });

  it('classifies provider rejection of the from-address as from_not_allowed', async () => {
    const fetchImpl = jest.fn(async () => ({
      ...jsonResponse({ error: { message: 'The from address is not allowed' } }, { status: 403 }),
      text: async () => 'The from address is not allowed',
    }));
    await expect(
      sendEmailAction(validMeta(), RUN, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        db: makeDb() as any,
      })
    ).rejects.toMatchObject({ code: 'from_not_allowed', retryable: false });
  });

  it('classifies quota exhaustion and auth revocation', async () => {
    const quota = jest.fn(async () => ({
      ...jsonResponse({}, { status: 429 }),
      text: async () => 'User-rate limit exceeded',
    }));
    await expect(
      sendEmailAction(validMeta(), RUN, { fetchImpl: quota as unknown as typeof fetch, db: makeDb() as any })
    ).rejects.toMatchObject({ code: 'quota', retryable: false });

    const revoked = jest.fn(async () => ({
      ...jsonResponse({}, { status: 401 }),
      text: async () => 'Invalid Credentials',
    }));
    await expect(
      sendEmailAction(validMeta(), RUN, { fetchImpl: revoked as unknown as typeof fetch, db: makeDb() as any })
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('fails closed when no Gmail connection exists', async () => {
    const db = {
      gmailServer: { findFirst: jest.fn(async () => null), update: jest.fn() },
    };
    await expect(
      sendEmailAction(validMeta(), RUN, { fetchImpl: jest.fn() as any, db: db as any })
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('refreshes an expired token and retries transient 5xx only', async () => {
    const expired = { ...server, accessToken: 'stale', tokenExpiry: new Date(Date.now() - 1000) };
    const db = {
      gmailServer: { findFirst: jest.fn(async () => expired), update: jest.fn(async () => expired) },
    };
    const fetchImpl = jest.fn(async (url: string) => {
      if (String(url).includes('oauth2.googleapis.com/token'))
        return jsonResponse({ access_token: 'ya29.fresh', expires_in: 3600 });
      return jsonResponse({ id: 'sent-after-refresh' });
    });
    const out = await sendEmailAction(validMeta(), RUN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      db: db as any,
    });
    expect(out.messageId).toBe('sent-after-refresh');
    expect(db.gmailServer.update).toHaveBeenCalled();
    const send = fetchImpl.mock.calls.find(([url]) => String(url).includes('messages/send'))!;
    expect((send[1] as any).headers.Authorization).toBe('Bearer ya29.fresh');

    const server5xx = jest.fn(async () => ({
      ...jsonResponse({}, { status: 503 }),
      text: async () => 'backend error',
    }));
    await expect(
      sendEmailAction(validMeta(), RUN, {
        fetchImpl: server5xx as unknown as typeof fetch,
        db: makeDb() as any,
      })
    ).rejects.toMatchObject({ code: 'provider', retryable: true });
  });

  it('never leaks tokens in error messages', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('boom');
    });
    await sendEmailAction(validMeta(), RUN, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      db: makeDb() as any,
    }).catch((error: EmailActionError) => {
      expect(error.message).not.toContain('ya29');
      expect(error.message).not.toContain('rtoken');
    });
  });
});
