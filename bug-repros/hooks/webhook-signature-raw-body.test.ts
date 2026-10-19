/**
 * BUG: generic webhook signature verification hashes a RE-SERIALIZED body, not
 * the bytes the client signed.
 *
 * apps/hooks/src/index.ts:29 installs `express.json()` without a `verify` hook,
 * so the raw request body is discarded; :57 then calls
 * `verifyWebhookRequest(req.headers, req.body, …)` and webhookAuth.ts:102 does
 * `JSON.stringify(body ?? {})` before computing the HMAC.
 *
 * Any legitimate client that signs the exact payload it sends — pretty-printed
 * JSON, a different key order, escaped unicode, a trailing newline, or a
 * non-JSON content type — gets 401 "Invalid webhook signature", even though the
 * documented contract is "x-webhook-signature: sha256=<hex> (HMAC-SHA256 of
 * JSON payload)". Signature auth is therefore unusable for those clients, and
 * the failure is indistinguishable from a bad secret.
 *
 * Expected (green): verification succeeds for a signature computed over the raw
 * request bytes.
 */
import crypto from 'crypto';
import { verifyWebhookRequest } from '../../apps/hooks/src/webhookAuth';

const SECRET = 'per-zap-webhook-secret';
const triggerMetadata = { secret: SECRET };

const sign = (raw: string) =>
  `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

describe('verifyWebhookRequest signature input', () => {
  it('accepts a signature computed over pretty-printed request bytes', () => {
    const raw = JSON.stringify({ event_id: 'evt-1', order: { id: 42 } }, null, 2);
    const result = verifyWebhookRequest(
      { 'x-webhook-signature': sign(raw) },
      JSON.parse(raw),
      triggerMetadata
    );

    // express.json() collapses the whitespace, so JSON.stringify(body) !== raw
    // and the HMAC no longer matches.
    expect(result).toEqual({ authorized: true });
  });

  it('accepts a signature computed over a payload with a different key order', () => {
    const raw = '{"order":{"id":42},"event_id":"evt-2"}';
    const result = verifyWebhookRequest(
      { 'x-webhook-signature': sign(raw) },
      { event_id: 'evt-2', order: { id: 42 } },
      triggerMetadata
    );

    expect(result).toEqual({ authorized: true });
  });

  it('still rejects a signature made with the wrong secret (control)', () => {
    const raw = '{"event_id":"evt-3"}';
    const forged = `sha256=${crypto.createHmac('sha256', 'wrong-secret').update(raw).digest('hex')}`;

    const result = verifyWebhookRequest(
      { 'x-webhook-signature': forged },
      JSON.parse(raw),
      triggerMetadata
    );

    expect(result).toEqual(
      expect.objectContaining({ authorized: false, status: 401 })
    );
  });

  it('accepts the canonical compact serialization (control)', () => {
    const raw = '{"event_id":"evt-4"}';
    const result = verifyWebhookRequest(
      { 'x-webhook-signature': sign(raw) },
      JSON.parse(raw),
      triggerMetadata
    );

    expect(result).toEqual({ authorized: true });
  });
});
