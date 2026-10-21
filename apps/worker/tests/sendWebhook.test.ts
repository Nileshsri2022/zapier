import {
  MAX_REDIRECTS,
  WebhookActionError,
  buildRequest,
  runWebhookAction,
} from '../src/sendWebhook';

/**
 * A4 spec acceptance (docs/ask-matt/actions/webhook.md, grilled round 14):
 * Q-WHA-01 five verbs · Q-WHA-02 none/basic/bearer/api-key ·
 * Q-WHA-03 json/form/raw · Q-WHA-04 response surface ·
 * Q-WHA-05 idempotent-only retries · Q-WHA-06 status policy override.
 */

const sleep = async () => {};

function response(
  body: string,
  init: {
    status?: number;
    contentType?: string;
    headers?: Record<string, string>;
    chunks?: string[];
  } = {}
) {
  const status = init.status ?? 200;
  const headers = { ...(init.headers ?? {}) };
  if (init.contentType !== undefined) headers['content-type'] = init.contentType;
  const bytes = Buffer.from(body, 'utf8');
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
      forEach: (cb: (value: string, key: string) => void) =>
        Object.entries(headers).forEach(([key, value]) => cb(value, key)),
    },
    text: async () => body,
    json: async () => JSON.parse(body),
    body: init.chunks
      ? {
          getReader: () => {
            let index = 0;
            return {
              read: async () =>
                index < init.chunks!.length
                  ? { done: false, value: Buffer.from(init.chunks![index++], 'utf8') }
                  : { done: true, value: undefined },
              cancel: async () => {},
            };
          },
        }
      : {
          getReader: () => {
            let sent = false;
            return {
              read: async () => {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: bytes };
              },
              cancel: async () => {},
            };
          },
        },
  } as unknown as Response;
}

const fetchOnce = (res: Response) => jest.fn(async () => res) as unknown as typeof fetch;
const calls = (fetchImpl: typeof fetch) => (fetchImpl as unknown as jest.Mock).mock.calls;

describe('Q-WHA-01/Q-WHA-03 request building', () => {
  it('templates url/query/headers/body and defaults JSON content-type', () => {
    const built = buildRequest(
      {
        method: 'post',
        url: 'https://api.example.com/v1/orders/{{orderId}}',
        query: { dry: 'false', source: '{{source}}' },
        headers: { 'X-Custom': '{{orderId}}' },
        bodyMode: 'json',
        body: { sku: '{{sku}}', qty: 3 },
      },
      { orderId: 'ord_9', source: 'zap', sku: 'ABC-1' }
    );
    expect(built.method).toBe('POST');
    expect(built.url).toContain('https://api.example.com/v1/orders/ord_9');
    expect(built.url).toContain('dry=false');
    expect(built.url).toContain('source=zap');
    expect(built.headers['X-Custom']).toBe('ord_9');
    expect(built.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(built.body!)).toEqual({ sku: 'ABC-1', qty: 3 });
  });

  it('supports form and raw body modes', () => {
    const form = buildRequest(
      { method: 'POST', url: 'https://a.example.com', bodyMode: 'form', body: { a: 1, b: 'two' } },
      {}
    );
    expect(form.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(form.body).toBe('a=1&b=two');

    const raw = buildRequest(
      { method: 'PUT', url: 'https://a.example.com', bodyMode: 'raw', body: 'hello {{name}}' },
      { name: 'Ada' }
    );
    expect(raw.body).toBe('hello Ada');
    expect(raw.headers['Content-Type']).toContain('text/plain');
  });

  it('resolves placeholders inside a JSON string body (issue #53)', () => {
    // The payload the old regex-over-serialized-text approach mangled: JSON's
    // own braces collided with the placeholder braces, so nothing resolved.
    const built = buildRequest(
      {
        method: 'POST',
        url: 'https://api.example.com/x',
        bodyMode: 'json',
        body: '{"text":"{message}","nested":{"a":"{name}"}}',
      },
      { message: 'hello', name: 'Ada' }
    );

    expect(JSON.parse(built.body!)).toEqual({ text: 'hello', nested: { a: 'Ada' } });
  });

  it('keeps a substituted quote and newline inside valid JSON on the wire', () => {
    const built = buildRequest(
      {
        method: 'POST',
        url: 'https://api.example.com/x',
        bodyMode: 'json',
        body: '{"text":"{value}","qty":"{qty}"}',
      },
      { value: 'He said "hi"\nnext', qty: 3 }
    );

    // Parseable at all is the assertion: the old code produced invalid JSON.
    expect(JSON.parse(built.body!)).toEqual({ text: 'He said "hi"\nnext', qty: 3 });
  });

  it('fails loudly when a json-mode body is not JSON', () => {
    expect(() =>
      buildRequest(
        {
          method: 'POST',
          url: 'https://api.example.com/x',
          bodyMode: 'json',
          body: 'hello {name}',
        },
        { name: 'Ada' }
      )
    ).toThrow(WebhookActionError);
  });

  it('accepts all five verbs and rejects unsupported ones/bodies on GET', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(buildRequest({ method, url: 'https://a.example.com' }, {}).method).toBe(method);
    expect(() => buildRequest({ method: 'TRACE', url: 'https://a.example.com' }, {})).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() =>
      buildRequest(
        { method: 'GET', url: 'https://a.example.com', bodyMode: 'json', body: { a: 1 } },
        {}
      )
    ).toThrow(expect.objectContaining({ code: 'validation' }));
  });

  it('rejects multipart (backlog) and missing URLs', () => {
    expect(() =>
      buildRequest({ method: 'POST', url: 'https://a.example.com', bodyMode: 'multipart' }, {})
    ).toThrow(expect.objectContaining({ code: 'validation' }));
    expect(() => buildRequest({ method: 'POST', url: '' }, {})).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
  });
});

describe('Q-WHA-02 auth modes', () => {
  const base = { method: 'GET', url: 'https://api.example.com/x' };

  it('applies bearer, basic and api-key (header or query) auth', () => {
    expect(
      buildRequest({ ...base, auth: { type: 'bearer', token: 'tok' } }, {}).headers.Authorization
    ).toBe('Bearer tok');
    expect(
      buildRequest({ ...base, auth: { type: 'basic', username: 'u', password: 'p' } }, {}).headers
        .Authorization
    ).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
    expect(
      buildRequest({ ...base, auth: { type: 'api_key', apiKey: 'k', apiKeyName: 'X-Key' } }, {})
        .headers['X-Key']
    ).toBe('k');
    expect(
      buildRequest(
        { ...base, auth: { type: 'api_key', apiKey: 'k', in: 'query', apiKeyName: 'api_key' } },
        {}
      ).url
    ).toContain('api_key=k');
  });

  it('rejects OAuth2 (backlog) and missing credentials', () => {
    expect(() => buildRequest({ ...base, auth: { type: 'oauth2' } }, {})).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
    expect(() => buildRequest({ ...base, auth: { type: 'bearer' } }, {})).toThrow(
      expect.objectContaining({ code: 'validation' })
    );
  });
});

describe('Q-WHA-04 response contract', () => {
  it('returns status/ok/parsed body/text/headers/duration/url/retries', async () => {
    const fetchImpl = fetchOnce(
      response('{"id":"ord_9","state":"created"}', {
        status: 201,
        contentType: 'application/json',
        headers: { 'content-type': 'application/json', 'x-request-id': 'r-1' },
      })
    );
    const out = await runWebhookAction(
      {
        method: 'POST',
        url: 'https://api.example.com/v1/orders',
        query: { dry: 'false' },
        bodyMode: 'json',
        body: { sku: 'ABC-1', qty: 3 },
      },
      {},
      { fetchImpl, sleep, now: () => 1_700_000_000_000 }
    );
    expect(out).toMatchObject({
      status: 201,
      ok: true,
      responseBody: { id: 'ord_9', state: 'created' },
      retries: 0,
      truncated: false,
      error: null,
      durationMs: 0,
    });
    expect(out.url).toContain('?dry=false');
    expect(out.responseHeaders['x-request-id']).toBe('r-1');
    expect(out.responseText).toContain('ord_9');
    const [url, init] = calls(fetchImpl)[0] as [string, any];
    expect(url).toContain('https://api.example.com/v1/orders?dry=false');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ sku: 'ABC-1', qty: 3 }));
  });

  it('keeps non-JSON bodies usable via responseText', async () => {
    const fetchImpl = fetchOnce(response('plain ok', { contentType: 'text/plain' }));
    const out = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/text' },
      {},
      { fetchImpl, sleep }
    );
    expect(out.responseBody).toBeNull();
    expect(out.responseText).toBe('plain ok');
    expect(out.ok).toBe(true);
  });

  it('flags responses over the 10 MB cap as truncated', async () => {
    const big = 'x'.repeat(9 * 1024 * 1024);
    const fetchImpl = fetchOnce(response('', { contentType: 'text/plain', chunks: [big, big] }));
    const out = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/big' },
      {},
      { fetchImpl, sleep }
    );
    expect(out.truncated).toBe(true);
  });

  it('never crashes on a JSON content-type with invalid JSON', async () => {
    const fetchImpl = fetchOnce(response('<html>oops</html>', { contentType: 'application/json' }));
    const out = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/x' },
      {},
      { fetchImpl, sleep }
    );
    expect(out.responseBody).toBeNull();
    expect(out.responseText).toContain('oops');
  });
});

describe('Q-WHA-06 status policy', () => {
  it('non-2xx is an error by default, with status and a body excerpt', async () => {
    const fetchImpl = fetchOnce(
      response('{"error":"nope"}', { status: 404, contentType: 'application/json' })
    );
    const error = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/x' },
      {},
      { fetchImpl, sleep }
    ).then(
      () => null,
      (rejection: WebhookActionError) => rejection
    );
    expect(error).toBeInstanceOf(WebhookActionError);
    expect(error!.code).toBe('http_status');
    expect(error!.status).toBe(404);
    expect(error!.message).toContain('HTTP 404');
    expect(error!.message).toContain('404');
    expect(error!.message).toContain('nope');
  });

  it('a per-step override accepts specific codes or any status', async () => {
    const fetchImpl = fetchOnce(response('missing', { status: 404, contentType: 'text/plain' }));
    const specific = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/x', acceptStatuses: '404' },
      {},
      { fetchImpl, sleep }
    );
    expect(specific.ok).toBe(true);
    expect(specific.status).toBe(404);

    const anyStatus = await runWebhookAction(
      {
        method: 'POST',
        url: 'https://api.example.com/x',
        acceptStatuses: 'any',
        bodyMode: 'json',
        body: {},
      },
      {},
      { fetchImpl, sleep }
    );
    expect(anyStatus.ok).toBe(true);
  });
});

describe('Q-WHA-05 idempotent-only retries', () => {
  it('retries 5xx on GET with bounded backoff, then succeeds and reports retries', async () => {
    const fetchImpl = jest.fn(async () =>
      fetchCalls++ === 0
        ? response('boom', { status: 500 })
        : response('ok', { contentType: 'text/plain' })
    ) as unknown as typeof fetch;
    let fetchCalls = 0;
    const out = await runWebhookAction(
      { method: 'GET', url: 'https://api.example.com/x' },
      {},
      { fetchImpl, sleep }
    );
    expect(out.status).toBe(200);
    expect(out.retries).toBe(1);
    expect(calls(fetchImpl)).toHaveLength(2);
  });

  it('does NOT retry 5xx on POST or PATCH (no duplicate side effects)', async () => {
    for (const method of ['POST', 'PATCH']) {
      const fetchImpl = fetchOnce(response('boom', { status: 500, contentType: 'text/plain' }));
      await expect(
        runWebhookAction(
          { method, url: 'https://api.example.com/x', bodyMode: 'json', body: { a: 1 } },
          {},
          { fetchImpl, sleep }
        )
      ).rejects.toMatchObject({ code: 'http_status', status: 500, retryable: false });
      expect(calls(fetchImpl)).toHaveLength(1);
    }
  });

  it('never retries 4xx, even on idempotent verbs', async () => {
    const fetchImpl = fetchOnce(response('bad', { status: 400, contentType: 'text/plain' }));
    await expect(
      runWebhookAction(
        { method: 'DELETE', url: 'https://api.example.com/x' },
        {},
        { fetchImpl, sleep }
      )
    ).rejects.toMatchObject({ code: 'http_status', status: 400 });
    expect(calls(fetchImpl)).toHaveLength(1);
  });

  it('retries a GET timeout then classifies failure after the bounded budget', async () => {
    const fetchImpl = jest.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;
    await expect(
      runWebhookAction(
        { method: 'GET', url: 'https://api.example.com/x', timeoutMs: 10 },
        {},
        { fetchImpl, sleep }
      )
    ).rejects.toMatchObject({ code: 'timeout' });
    expect(calls(fetchImpl)).toHaveLength(3);
  });
});

describe('redirects and SSRF guardrails (spec §5)', () => {
  it('follows up to 5 redirects and strips Authorization across hosts', async () => {
    const seen: any[] = [];
    const fetchImpl = jest.fn(async (url: string, init: any) => {
      seen.push({ url, headers: init.headers });
      if (url.includes('start.example.com'))
        return response('', {
          status: 302,
          headers: { location: 'https://other.example.com/final' },
        });
      return response('done', { contentType: 'text/plain' });
    }) as unknown as typeof fetch;

    const out = await runWebhookAction(
      {
        method: 'GET',
        url: 'https://start.example.com/go',
        auth: { type: 'bearer', token: 'secret-token' },
      },
      {},
      { fetchImpl, sleep }
    );
    expect(out.status).toBe(200);
    expect(out.url).toBe('https://other.example.com/final');
    expect(seen[0].headers.Authorization).toBe('Bearer secret-token');
    expect(seen[1].headers.Authorization).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain('secret-token');
  });

  it('stops after the redirect cap', async () => {
    const fetchImpl = jest.fn(async () =>
      response('', { status: 302, headers: { location: 'https://loop.example.com/again' } })
    ) as unknown as typeof fetch;
    await expect(
      runWebhookAction(
        { method: 'GET', url: 'https://loop.example.com/start' },
        {},
        { fetchImpl, sleep }
      )
    ).rejects.toMatchObject({ code: 'too_many_redirects' });
    expect(calls(fetchImpl).length).toBe(MAX_REDIRECTS + 1);
  });

  it('blocks loopback, private and metadata targets unless explicitly allowed', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    for (const url of [
      'http://localhost:3000/x',
      'http://127.0.0.1/x',
      'http://169.254.169.254/latest/meta-data',
      'http://192.168.1.10/x',
      'http://[::1]/x',
      'file:///etc/passwd',
    ])
      await expect(
        runWebhookAction({ method: 'GET', url }, {}, { fetchImpl, sleep })
      ).rejects.toBeInstanceOf(WebhookActionError);
    expect(calls(fetchImpl)).toHaveLength(0);

    const allowed = fetchOnce(response('ok', { contentType: 'text/plain' }));
    await expect(
      runWebhookAction(
        { method: 'GET', url: 'http://127.0.0.1:8080/x', allowPrivateNetwork: true },
        {},
        { fetchImpl: allowed, sleep }
      )
    ).resolves.toMatchObject({ ok: true });
  });
});

describe('secret redaction', () => {
  it('keeps credentials out of output and error text', async () => {
    const fetchImpl = fetchOnce(
      response('denied for sec-token', { status: 401, contentType: 'text/plain' })
    );
    const error = await runWebhookAction(
      {
        method: 'GET',
        url: 'https://api.example.com/x',
        auth: { type: 'bearer', token: 'sec-token' },
      },
      {},
      { fetchImpl, sleep }
    ).then(
      () => null,
      (rejection: WebhookActionError) => rejection
    );
    expect(error!.message).not.toContain('sec-token');
    expect(error!.message).toContain('<redacted>');

    const queryKey = fetchOnce(response('ok', { contentType: 'text/plain' }));
    const out = await runWebhookAction(
      {
        method: 'GET',
        url: 'https://api.example.com/x',
        auth: { type: 'api_key', apiKey: 'k-123', in: 'query', apiKeyName: 'api_key' },
      },
      {},
      { fetchImpl: queryKey, sleep }
    );
    expect(out.url).not.toContain('k-123');
    expect(out.url).toContain('<redacted>');
  });
});
