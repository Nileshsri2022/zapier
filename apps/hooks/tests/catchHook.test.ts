import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import client from '@repo/db';

const mockEnqueueRun = jest.fn();
jest.mock('@repo/runs', () => ({
  enqueueRun: (input: any) => mockEnqueueRun(input),
}));

import {
  createCatchHookRouter,
  MAX_WEBHOOK_BYTES,
  parseHookBody,
  surfaceHeaders,
} from '../src/catchHook';

/**
 * T5 — Catch Hook fixtures (docs/ask-matt/triggers/webhook.md round 7,
 * ticket T-WHT-02): five verbs, JSON/form/non-JSON/oversize, auth modes,
 * duplicate x-request-id, test-hook capture, rotation revoke, contract.
 */

const app = express();
app.use('/hooks', createCatchHookRouter());

let triggerMetadata: any = {};
const mockTriggerUpdate = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockEnqueueRun.mockResolvedValue({ status: 'queued', zapRunId: 'run-1', dispatched: true });
  mockTriggerUpdate.mockResolvedValue({});
  triggerMetadata = { secret: 'shh', authMode: 'hmac' };
  (client.zap.findUnique as jest.Mock).mockImplementation(async () => ({
    id: 'zap-1',
    isActive: true,
    trigger: { id: 'trigger-1', metadata: triggerMetadata as any },
  }));
  (client.trigger.update as jest.Mock) = mockTriggerUpdate;
  delete process.env.WEBHOOK_SECRET;
});

const hook = (path = '/hooks/user-1/zap-1') => request(app).post(path);

describe('V1 — five verbs + V3 fixed 200 empty', () => {
  beforeEach(() => {
    triggerMetadata = {}; // auth none (no secret, no mode)
  });

  const send = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') => (path: string) => {
    const r = request(app);
    switch (method) {
      case 'GET':
        return r.get(path);
      case 'POST':
        return r.post(path);
      case 'PUT':
        return r.put(path);
      case 'PATCH':
        return r.patch(path);
      case 'DELETE':
        return r.delete(path);
    }
  };

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s is accepted with a 200 empty-body ack and exactly one run',
    async (method) => {
      const req = send(method)('/hooks/user-1/zap-1');
      const res = method === 'GET' ? await req : await req.send({ hello: 'world' });

      expect(res.status).toBe(200);
      expect(res.text).toBe('');
      expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    }
  );

  it('GET exposes query params with an empty body object', async () => {
    const res = await request(app).get('/hooks/user-1/zap-1?token=abc&x=1');

    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.query).toEqual({ token: 'abc', x: '1' });
    expect(metadata.body).toEqual({});
    expect(metadata.method).toBe('GET');
  });

  it('OPTIONS preflight is answered without a run', async () => {
    const res = await request(app).options('/hooks/user-1/zap-1');
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('method restriction (metadata.methods) rejects non-listed verbs with 405', async () => {
    triggerMetadata = { methods: ['POST'] };
    const res = await request(app).delete('/hooks/user-1/zap-1');
    expect(res.status).toBe(405);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});

describe('V5 — payload parsing matrix', () => {
  beforeEach(() => {
    triggerMetadata = {};
  });

  it('JSON body lands in body; bodyRaw always present; contract fields complete', async () => {
    const res = await request(app)
      .post('/hooks/user-1/zap-1')
      .set('Content-Type', 'application/json')
      .set('x-request-id', 'req-9')
      .send({ event: 'payment.succeeded', amount: 499, data: { items: [{ sku: 'A1' }] } });

    expect(res.status).toBe(200);
    const input = mockEnqueueRun.mock.calls[0][0];
    const m = input.metadata;
    expect(m.body).toEqual({
      event: 'payment.succeeded',
      amount: 499,
      data: { items: [{ sku: 'A1' }] },
    });
    expect(m.bodyRaw).toContain('"payment.succeeded"');
    expect(m.method).toBe('POST');
    expect(m.url).toContain('/hooks/user-1/zap-1');
    expect(m.pathParams).toEqual({ userId: 'user-1', zapId: 'zap-1' });
    expect(typeof m.receivedAt).toBe('string');
    // legacy: body fields still spread at top level
    expect(m.event).toBe('payment.succeeded');
    expect(input.dedup).toEqual({ scope: 'webhook', key: 'zap-1:req-9' });
    // nested/array addressing works: body.data.items.0.sku
    expect(m.body.data.items[0].sku).toBe('A1');
  });

  it('x-www-form-urlencoded becomes a field map', async () => {
    const res = await request(app)
      .post('/hooks/user-1/zap-1')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('a=1&b=two');

    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.body).toEqual({ a: '1', b: 'two' });
    expect(metadata.bodyRaw).toBe('a=1&b=two');
  });

  it('non-JSON content (multipart/XML-style) → body null + bodyRaw carries the raw', async () => {
    const res = await request(app)
      .post('/hooks/user-1/zap-1')
      .set('Content-Type', 'application/xml')
      .send('<event>hi</event>');

    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.body).toBeNull();
    expect(metadata.bodyRaw).toBe('<event>hi</event>');
  });

  it('invalid JSON keeps raw in bodyRaw instead of crashing', async () => {
    const res = await request(app)
      .post('/hooks/user-1/zap-1')
      .set('Content-Type', 'application/json')
      .send('{not json');

    expect(res.status).toBe(200);
    const { metadata } = mockEnqueueRun.mock.calls[0][0];
    expect(metadata.body).toBeNull();
    expect(metadata.bodyRaw).toBe('{not json');
  });

  it(`body beyond ${MAX_WEBHOOK_BYTES} bytes → 413, no run`, async () => {
    const big = 'x'.repeat(MAX_WEBHOOK_BYTES + 10);
    const res = await request(app)
      .post('/hooks/user-1/zap-1')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ big }));

    expect(res.status).toBe(413);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('redacts authorization/cookie and allowlists x-* headers', () => {
    const surfaced = surfaceHeaders({
      Authorization: 'Bearer super-secret',
      Cookie: 'session=1',
      'X-Request-Id': 'r1',
      'X-Custom-Sender-Header': 'v',
      'Accept-Language': 'en-US', // not on the allowlist → dropped
    });
    expect(surfaced).toEqual({
      authorization: '[redacted]',
      cookie: '[redacted]',
      'x-request-id': 'r1',
      'x-custom-sender-header': 'v',
    });
  });

  it('parseHookBody falls back safely on empty input', () => {
    expect(parseHookBody(undefined, undefined)).toEqual({ body: {}, bodyRaw: '' });
  });
});

describe('V4 — auth modes', () => {
  it('static mode: missing key → 401, wrong key → 401, right key → run', async () => {
    triggerMetadata = { authMode: 'static', secret: 'k-123' };

    const missing = await hook().send({});
    expect(missing.status).toBe(401);
    expect(mockEnqueueRun).not.toHaveBeenCalled();

    const wrong = await hook().set('x-webhook-secret', 'nope').send({});
    expect(wrong.status).toBe(401);

    const ok = await hook().set('x-webhook-secret', 'k-123').send({});
    expect(ok.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('hmac mode: missing signature → 403, invalid → 403, valid → run', async () => {
    triggerMetadata = { authMode: 'hmac', secret: 'hk' };
    const body = { a: 1 };
    const raw = JSON.stringify(body);
    const valid = `sha256=${crypto.createHmac('sha256', 'hk').update(raw).digest('hex')}`;

    const missing = await hook().send(body);
    expect(missing.status).toBe(403);
    expect(mockEnqueueRun).not.toHaveBeenCalled();

    const invalid = await hook().set('x-webhook-signature', 'sha256=bad').send(body);
    expect(invalid.status).toBe(403);

    const ok = await hook().set('x-webhook-signature', valid).send(body);
    expect(ok.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('authMode none → open hook even when a secret exists', async () => {
    triggerMetadata = { authMode: 'none', secret: 'ignored' };
    const res = await hook().send({ hi: 1 });
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });
});

describe('V6 — x-request-id dedupe', () => {
  beforeEach(() => {
    triggerMetadata = {};
  });

  it('same x-request-id redelivered → 200 ack with the same dedupe key (one logical run)', async () => {
    mockEnqueueRun.mockResolvedValueOnce({ status: 'queued', zapRunId: 'run-1' });
    const first = await hook().set('x-request-id', 'dup-1').send({ n: 1 });
    mockEnqueueRun.mockResolvedValueOnce({ status: 'duplicate' });
    const second = await hook().set('x-request-id', 'dup-1').send({ n: 1 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe('');
    const keys = mockEnqueueRun.mock.calls.map((c: any[]) => c[0].dedup.key);
    expect(keys).toEqual(['zap-1:dup-1', 'zap-1:dup-1']);
  });

  it('legacy body event_id still dedupes when x-request-id is absent', async () => {
    triggerMetadata = {};
    await hook().send({ event_id: 'e-7' });
    const { dedup } = mockEnqueueRun.mock.calls[0][0];
    expect(dedup.key).toBe('zap-1:e-7');
  });

  it('no dedupe id at all → dedup key undefined (always runs)', async () => {
    await hook().send({ plain: true });
    expect(mockEnqueueRun.mock.calls[0][0].dedup.key).toBeUndefined();
  });
});

describe('V2 — test vs production URLs + rotation', () => {
  it('test hook stores a sample (capped) and never enqueues', async () => {
    triggerMetadata = { testHookId: 't-1', hookSamples: [{ receivedAt: 'old' }] };
    const res = await request(app)
      .post('/hooks/test/user-1/zap-1/t-1')
      .set('Content-Type', 'application/json')
      .send({ sample: true });

    expect(res.status).toBe(200);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(mockTriggerUpdate).toHaveBeenCalledTimes(1);
    const data = mockTriggerUpdate.mock.calls[0][0].data;
    expect(data.metadata.hookSamples).toHaveLength(2);
    expect(data.metadata.hookSamples[0].body).toEqual({ sample: true });
    expect(data.metadata.hookSamples[0].receivedAt).toBeDefined();
  });

  it('test hook with revoked/wrong id → 410, no sample, no run', async () => {
    triggerMetadata = { testHookId: 't-2' };
    const res = await request(app).post('/hooks/test/user-1/zap-1/old-test-id').send({});
    expect(res.status).toBe(410);
    expect(mockTriggerUpdate).not.toHaveBeenCalled();
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('rotated hook: current hookId URL works, base URL and old id fail immediately', async () => {
    triggerMetadata = { prodHookId: 'new-id' };

    const base = await hook().send({});
    expect(base.status).toBe(410);
    expect(base.body.error).toMatch(/rotated/i);

    const old = await hook('/hooks/user-1/zap-1/old-id').send({});
    expect(old.status).toBe(410);

    const current = await hook('/hooks/user-1/zap-1/new-id').send({});
    expect(current.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('legacy zaps (no prodHookId) keep working on the base URL', async () => {
    triggerMetadata = {};
    const res = await hook().send({});
    expect(res.status).toBe(200);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
  });

  it('unknown zap → 404', async () => {
    (client.zap.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await hook().send({});
    expect(res.status).toBe(404);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });
});
