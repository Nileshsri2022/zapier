import {
  WhatsAppActionError,
  assertMediaReachable,
  normalizeRecipient,
  resolveSender,
  sendWhatsAppAction,
} from '../src/sendWhatsApp';

/**
 * A5 spec acceptance (docs/ask-matt/actions/whatsapp.md, grilled round 15).
 * Q-WA-A-01 templates + freeform/24h · Q-WA-A-02 dropdown + positional params ·
 * Q-WA-A-03 media link + caption · Q-WA-A-04 strict phone ·
 * Q-WA-A-05 API-accepted = success · Q-WA-A-06 sender from the connection.
 */

const SERVER = {
  id: 'srv-wa',
  phoneNumberId: '109800000000001',
  accessToken: 'EAAG-secret-token',
  businessId: 'biz-1',
  displayName: 'ZapMate',
  phoneNumber: '+91 98765 43210',
};

const RUN = { userId: 42 };

const dbWith = (rows: any[] = [SERVER]) => ({
  whatsAppServer: {
    findFirst: jest.fn(async ({ where }: any) => {
      return (
        rows.find(
          (row) =>
            (!where.userId || row.userId === undefined || where.userId === 42) &&
            (!where.phoneNumberId || row.phoneNumberId === where.phoneNumberId)
        ) ?? null
      );
    }),
  },
});

const okResponse = (id = 'wamid.HBgLM') =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id }] }),
    text: async () => JSON.stringify({ messages: [{ id }] }),
  }) as unknown as Response;

const errorResponse = (status: number, error: any) =>
  ({
    ok: false,
    status,
    json: async () => ({ error }),
    text: async () => JSON.stringify({ error }),
  }) as unknown as Response;

const sentPayload = (fetchImpl: typeof fetch) =>
  JSON.parse((fetchImpl as unknown as jest.Mock).mock.calls.at(-1)[1].body);

describe('Q-WA-A-04 strict recipient validation', () => {
  it('accepts country-coded numbers with optional +/formatting', () => {
    expect(normalizeRecipient('+91 98765 43210').to).toBe('919876543210');
    expect(normalizeRecipient('1 (555) 123-4567').to).toBe('15551234567');
    expect(normalizeRecipient('919876543210').to).toBe('919876543210');
  });

  it('rejects missing country code, letters and too-short numbers pre-send', () => {
    for (const value of ['9876543210', '0' + '919876543210', 'abc', '+12', ''])
      expect(() => normalizeRecipient(value)).toThrow(
        expect.objectContaining({ code: 'invalid_recipient' })
      );
  });

  it('never calls the provider for an invalid recipient', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '98765', fromPhoneNumberId: SERVER.phoneNumberId, kind: 'freeform', freeform: { text: 'hi' } },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'invalid_recipient' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Q-WA-A-06 sender comes from the connection', () => {
  it('resolves the configured number id and rejects foreign ones', async () => {
    const server = await resolveSender({ fromPhoneNumberId: SERVER.phoneNumberId }, 42, dbWith() as any);
    expect(server.phoneNumberId).toBe(SERVER.phoneNumberId);

    await expect(
      resolveSender({ fromPhoneNumberId: '999999999' }, 42, dbWith() as any)
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('fails closed with no connection', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        RUN,
        { fetchImpl, db: dbWith([]) as any }
      )
    ).rejects.toMatchObject({ code: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Q-WA-A-02 templates with positional params', () => {
  it('sends an approved template with mapped positional params (§4 output)', async () => {
    const fetchImpl = jest.fn(async () => okResponse()) as unknown as typeof fetch;
    const out = await sendWhatsAppAction(
      {
        fromPhoneNumberId: SERVER.phoneNumberId,
        to: '919876543210',
        kind: 'template',
        template: {
          name: 'order_update',
          language: 'en',
          params: ['{{previousOutput.fields.name}}', 'OUT-42', 'Out for delivery'],
          paramCount: 3,
        },
      },
      { ...RUN, previousOutput: { fields: { name: 'Ada' } } },
      { fetchImpl, db: dbWith() as any, now: () => 1_700_000_000_000 }
    );
    expect(out).toEqual({
      sent: true,
      messageId: 'wamid.HBgLM',
      to: '919876543210',
      fromPhoneNumberId: SERVER.phoneNumberId,
      kind: 'template',
      acceptedAt: new Date(1_700_000_000_000).toISOString(),
      error: null,
    });
    const payload = sentPayload(fetchImpl);
    expect(payload.type).toBe('template');
    expect(payload.template.name).toBe('order_update');
    expect(payload.template.language).toEqual({ code: 'en' });
    expect(payload.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Ada' },
      { type: 'text', text: 'OUT-42' },
      { type: 'text', text: 'Out for delivery' },
    ]);
    const [url, init] = (fetchImpl as unknown as jest.Mock).mock.calls.at(-1);
    expect(url).toBe(`https://graph.facebook.com/v18.0/${SERVER.phoneNumberId}/messages`);
    expect((init as any).headers.Authorization).toBe(`Bearer ${SERVER.accessToken}`);
  });

  it('rejects a param-count mismatch before dispatch', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        {
          to: '919876543210',
          kind: 'template',
          template: { name: 'order_update', language: 'en', params: ['Ada'], paramCount: 3 },
        },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'param_count_mismatch' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies unapproved/missing templates from Meta', async () => {
    const notApproved = jest.fn(async () =>
      errorResponse(400, { code: 132005, message: 'Template is not approved' })
    ) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'template', template: { name: 'x', language: 'en' } },
        RUN,
        { fetchImpl: notApproved, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'template_not_approved' });

    const missing = jest.fn(async () =>
      errorResponse(404, { code: 132001, message: 'Template does not exist' })
    ) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'template', template: { name: 'x', language: 'en' } },
        RUN,
        { fetchImpl: missing, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'template_not_found' });
  });
});

describe('Q-WA-A-01 freeform and the 24h window', () => {
  it('sends freeform text inside the window', async () => {
    const fetchImpl = jest.fn(async () => okResponse('wamid.free')) as unknown as typeof fetch;
    const out = await sendWhatsAppAction(
      {
        to: '+91 98765 43210',
        kind: 'freeform',
        freeform: { text: 'Your order shipped 📦', previewUrl: true },
      },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(out.kind).toBe('freeform');
    expect(out.messageId).toBe('wamid.free');
    const payload = sentPayload(fetchImpl);
    expect(payload.type).toBe('text');
    expect(payload.text).toEqual({ preview_url: true, body: 'Your order shipped 📦' });
  });

  it('pre-rejects freeform outside the 24h window (no auto-fallback to a template)', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    const now = 1_700_000_000_000;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        { ...RUN, lastCustomerMessageAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
        { fetchImpl, db: dbWith() as any, now: () => now }
      )
    ).rejects.toMatchObject({ code: 'outside_session_window' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const insideFetch = jest.fn(async () => okResponse()) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        { ...RUN, lastCustomerMessageAt: new Date(now - 60 * 1000).toISOString() },
        { fetchImpl: insideFetch, db: dbWith() as any, now: () => now }
      )
    ).resolves.toMatchObject({ sent: true });
  });

  it('classifies Meta’s 131047 re-engagement rejection as outside_session_window', async () => {
    const fetchImpl = jest.fn(async () =>
      errorResponse(400, {
        code: 131047,
        message: 'Re-engagement message: message sent outside of the 24 hour window',
      })
    ) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'outside_session_window' });
  });

  it('rejects empty freeform messages and over-long text', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: '   ' } },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'validation' });

    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'x'.repeat(4097) } },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('Q-WA-A-03 media by link + caption', () => {
  it('verifies the media URL then sends type image with caption', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      String(url).includes('graph.facebook.com')
        ? okResponse('wamid.img')
        : ({ ok: true, status: 200 } as Response)
    ) as unknown as typeof fetch;

    const out = await sendWhatsAppAction(
      {
        to: '919876543210',
        kind: 'freeform',
        freeform: { text: '', mediaUrl: 'https://cdn.example.com/p.png', caption: 'Receipt' },
        mediaType: 'image',
      },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    expect(out.messageId).toBe('wamid.img');
    const payload = sentPayload(fetchImpl);
    expect(payload.type).toBe('image');
    expect(payload.image).toEqual({ link: 'https://cdn.example.com/p.png', caption: 'Receipt' });
  });

  it('fails the run when the media URL is unreachable (no silent text-only send)', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        {
          to: '919876543210',
          kind: 'freeform',
          freeform: { text: 'with media', mediaUrl: 'https://cdn.example.com/missing.pdf' },
        },
        RUN,
        { fetchImpl, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'media_fetch_failed' });
    expect((fetchImpl as unknown as jest.Mock).mock.calls).toHaveLength(1); // only the HEAD probe
  });

  it('rejects malformed media URLs pre-send', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    await expect(assertMediaReachable('not-a-url', fetchImpl)).rejects.toMatchObject({
      code: 'media_fetch_failed',
    });
    await expect(assertMediaReachable('ftp://x/y', fetchImpl)).rejects.toMatchObject({
      code: 'media_fetch_failed',
    });
  });
});

describe('credentials and transport', () => {
  it('never leaks the access token in errors or output', async () => {
    const fetchImpl = jest.fn(async () =>
      errorResponse(500, { code: 1, message: 'Internal error' })
    ) as unknown as typeof fetch;
    const out = await sendWhatsAppAction(
      { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
      RUN,
      { fetchImpl, db: dbWith() as any }
    ).then(
      () => null,
      (error: WhatsAppActionError) => error
    );
    expect(out).toBeInstanceOf(WhatsAppActionError);
    expect(out!.message).not.toContain('EAAG-secret-token');
  });

  it('classifies rate limits as retryable and 401 as auth', async () => {
    const limited = jest.fn(async () =>
      errorResponse(429, { code: 131056, message: 'Rate limit hit' })
    ) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        RUN,
        { fetchImpl: limited, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'rate_limited', retryable: true });

    const unauthorized = jest.fn(async () =>
      errorResponse(401, { code: 190, message: 'Invalid OAuth access token' })
    ) as unknown as typeof fetch;
    await expect(
      sendWhatsAppAction(
        { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
        RUN,
        { fetchImpl: unauthorized, db: dbWith() as any }
      )
    ).rejects.toMatchObject({ code: 'auth', retryable: false });
  });

  it('bounds every Graph request with an abort signal and timeout', async () => {
    const fetchImpl = jest.fn(async () => okResponse()) as unknown as typeof fetch;
    await sendWhatsAppAction(
      { to: '919876543210', kind: 'freeform', freeform: { text: 'hi' } },
      RUN,
      { fetchImpl, db: dbWith() as any }
    );
    const init = (fetchImpl as unknown as jest.Mock).mock.calls.at(-1)[1];
    expect(init.signal).toBeDefined();
    expect(init.signal.aborted).toBe(false);
  });
});
