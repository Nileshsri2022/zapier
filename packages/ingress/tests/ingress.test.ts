import crypto from 'crypto';
import {
  INGRESS_SPECS,
  OPEN_WHEN_UNCONFIGURED,
  constantTimeEquals,
  verifyCatchHook,
  verifyGithub,
  verifyGmailPush,
  verifyIngress,
  verifyLegacyWebhook,
  verifyTelegram,
  verifyWhatsapp,
} from '../src';

/**
 * One adversarial table for all six ingress surfaces.
 *
 * The point of the module is that these cases stop being per-provider
 * judgement calls: a missing secret, a missing header, a wrong credential and a
 * length mismatch must produce the same verdict everywhere (with the audited
 * open-door exceptions spelled out below).
 */

const SECRET = 'shhh-shared-secret';

const sign = (payload: string, secret = SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;

const RAW = '{"event":"push","n":1}';

describe('fail-closed default (Q3)', () => {
  const closed = [
    ['whatsapp', (s?: string) => verifyWhatsapp({ headers: {}, rawBody: RAW }, s)],
    ['telegram', (s?: string) => verifyTelegram({ headers: {}, rawBody: RAW }, s)],
    ['gmail-push', (s?: string) => verifyGmailPush({ headers: {}, rawBody: RAW }, s)],
    [
      'catch-hook-hmac',
      (s?: string) =>
        verifyCatchHook({ headers: {}, rawBody: RAW }, { authMode: 'hmac', secret: s }),
    ],
    [
      'catch-hook-static',
      (s?: string) =>
        verifyCatchHook({ headers: {}, rawBody: RAW }, { authMode: 'static', secret: s }),
    ],
    ['legacy-webhook', (s?: string) => verifyLegacyWebhook(RAW, undefined, s)],
  ] as const;

  it.each(closed)('%s refuses when no secret is configured', (_name, verify) => {
    const verdict = verify(undefined);
    expect(verdict).toMatchObject({ ok: false, code: 'SECRET_NOT_CONFIGURED' });
    if (!verdict.ok) expect([400, 401, 403]).toContain(verdict.status);
  });

  it.each(closed)('%s refuses an empty/whitespace secret', (_name, verify) => {
    expect(verify('   ')).toMatchObject({ ok: false, code: 'SECRET_NOT_CONFIGURED' });
  });
});

describe('audited open doors (Q7)', () => {
  it('the open-door list is exactly the three specified surfaces', () => {
    const open = Object.entries(INGRESS_SPECS)
      .filter(([, spec]) => spec.allowOpenWhenUnconfigured)
      .map(([name]) => name)
      .sort();
    expect(open).toEqual([...OPEN_WHEN_UNCONFIGURED].sort());
  });

  it('catch-hook `none` mode admits an unauthenticated request', () => {
    const verdict = verifyCatchHook(
      { headers: {}, rawBody: RAW },
      { authMode: 'none', secret: SECRET }
    );
    // Open mode never consults a credential, even when a secret exists.
    expect(verdict).toEqual({ ok: true });
  });

  it('legacy catch-hook with nothing configured stays a capability URL', () => {
    expect(verifyCatchHook({ headers: {}, rawBody: RAW }, {})).toEqual({ ok: true });
  });

  it('github is open only while unconfigured (transition), closed once set', () => {
    expect(verifyGithub({ headers: {}, rawBody: RAW }, undefined)).toEqual({ ok: true });
    expect(verifyGithub({ headers: {}, rawBody: RAW }, SECRET)).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
    });
  });
});

describe('HMAC adapters accept only the exact digest of the raw bytes', () => {
  it.each([
    [
      'whatsapp',
      (header: string) =>
        verifyWhatsapp({ headers: { 'x-hub-signature-256': header }, rawBody: RAW }, SECRET),
    ],
    [
      'github',
      (header: string) =>
        verifyGithub({ headers: { 'x-hub-signature-256': header }, rawBody: RAW }, SECRET),
    ],
  ])('%s: correct signature passes, wrong one refuses', (_name, run) => {
    expect(run(sign(RAW))).toEqual({ ok: true });
    expect(run(`sha256=${'0'.repeat(64)}`)).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
    });
  });

  it('gmail-push: bare hex digest (no prefix) over raw bytes', () => {
    const digest = crypto.createHmac('sha256', SECRET).update(RAW).digest('hex');
    expect(
      verifyGmailPush({ headers: { 'x-goog-signature': digest }, rawBody: RAW }, SECRET)
    ).toEqual({
      ok: true,
    });
    // A prefixed value must NOT pass: this provider sends bare hex.
    expect(
      verifyGmailPush({ headers: { 'x-goog-signature': `sha256=${digest}` }, rawBody: RAW }, SECRET)
    ).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
    expect(
      verifyGmailPush({ headers: { 'x-goog-signature': digest }, rawBody: `${RAW} ` }, SECRET)
    ).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
  });

  it('rejects a signature computed over different bytes (no re-serialization)', () => {
    const signedOverSomethingElse = sign('{"event":"push", "n":1}'); // extra space
    const verdict = verifyWhatsapp(
      { headers: { 'x-hub-signature-256': signedOverSomethingElse }, rawBody: RAW },
      SECRET
    );
    expect(verdict).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
  });

  it('rejects a digest of the right length but wrong secret', () => {
    const verdict = verifyWhatsapp(
      { headers: { 'x-hub-signature-256': sign(RAW, 'other-secret') }, rawBody: RAW },
      SECRET
    );
    expect(verdict).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
  });

  it('refuses a length-mismatched digest without throwing (constant-time guard)', () => {
    expect(() =>
      verifyWhatsapp(
        { headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody: RAW },
        SECRET
      )
    ).not.toThrow();
    expect(
      verifyWhatsapp(
        { headers: { 'x-hub-signature-256': 'sha256=deadbeef' }, rawBody: RAW },
        SECRET
      )
    ).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
  });
});

describe('Telegram: secret-token comparison, previously fail-open', () => {
  const headers = (token?: string) =>
    token === undefined ? {} : { 'x-telegram-bot-api-secret-token': token };

  it('accepts the exact token', () => {
    expect(verifyTelegram({ headers: headers('tg-secret') }, 'tg-secret')).toEqual({ ok: true });
  });

  it('refuses a wrong token and a missing header', () => {
    expect(verifyTelegram({ headers: headers('nope') }, 'tg-secret')).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
    });
    expect(verifyTelegram({ headers: headers() }, 'tg-secret')).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
    });
  });

  it('REGRESSION: an unset secret no longer opens the door', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(
      verifyTelegram({ headers: headers() }, process.env.TELEGRAM_WEBHOOK_SECRET)
    ).toMatchObject({
      ok: false,
      code: 'SECRET_NOT_CONFIGURED',
      status: 401,
    });
  });
});

describe('catch hook modes', () => {
  it('hmac mode requires a signature (403, matching T5 §5)', () => {
    expect(
      verifyCatchHook({ headers: {}, rawBody: RAW }, { authMode: 'hmac', secret: SECRET })
    ).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
      status: 403,
    });
    expect(
      verifyCatchHook(
        { headers: { 'x-webhook-signature': sign(RAW) }, rawBody: RAW },
        { authMode: 'hmac', secret: SECRET }
      )
    ).toEqual({ ok: true });
  });

  it('static mode accepts x-webhook-secret or Authorization: Bearer', () => {
    expect(
      verifyCatchHook(
        { headers: { 'x-webhook-secret': SECRET } },
        { authMode: 'static', secret: SECRET }
      )
    ).toEqual({ ok: true });
    expect(
      verifyCatchHook(
        { headers: { authorization: `Bearer ${SECRET}` } },
        { authMode: 'static', secret: SECRET }
      )
    ).toEqual({ ok: true });
    expect(
      verifyCatchHook(
        { headers: { 'x-webhook-secret': 'wrong' } },
        { authMode: 'static', secret: SECRET }
      )
    ).toMatchObject({ ok: false, code: 'INVALID_CREDENTIAL' });
  });

  it('legacy implicit mode accepts either a signature or the static key', () => {
    expect(
      verifyCatchHook(
        { headers: { 'x-webhook-signature': sign(RAW) }, rawBody: RAW },
        { secret: SECRET }
      )
    ).toEqual({ ok: true });
    expect(
      verifyCatchHook({ headers: { 'x-webhook-secret': SECRET } }, { secret: SECRET })
    ).toEqual({
      ok: true,
    });
    expect(verifyCatchHook({ headers: {} }, { secret: SECRET })).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
    });
    expect(
      verifyCatchHook({ headers: { 'x-webhook-secret': 'wrong' } }, { secret: SECRET })
    ).toMatchObject({
      ok: false,
      code: 'INVALID_CREDENTIAL',
    });
  });

  it('an unknown authMode is refused, never silently treated as legacy (Q6)', () => {
    // Legacy implicit mode is an audited open door; a config typo must not
    // inherit it.
    expect(verifyCatchHook({ headers: {} }, { authMode: 'weird' })).toEqual({
      ok: false,
      code: 'UNSUPPORTED_AUTH_MODE',
      status: 401,
      message: expect.stringContaining('weird'),
    });
    expect(
      verifyCatchHook({ headers: {}, rawBody: RAW }, { authMode: 'weird', secret: SECRET })
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_AUTH_MODE' });
  });

  it('an absent authMode still means legacy implicit', () => {
    expect(verifyCatchHook({ headers: {} }, { secret: SECRET })).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
    });
    expect(verifyCatchHook({ headers: {} }, {})).toEqual({ ok: true });
  });
});

describe('header handling', () => {
  it('is case-insensitive and tolerates array headers', () => {
    expect(
      verifyGithub({ headers: { 'X-Hub-Signature-256': [sign(RAW)] }, rawBody: RAW }, SECRET)
    ).toEqual({ ok: true });
  });

  it('ignores whitespace-only headers', () => {
    expect(
      verifyGithub({ headers: { 'x-hub-signature-256': '   ' }, rawBody: RAW }, SECRET)
    ).toMatchObject({
      ok: false,
      code: 'MISSING_CREDENTIAL',
    });
  });
});

describe('constant-time comparison (Q4)', () => {
  it('is true only for identical strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('returns false (never throws) on length mismatch', () => {
    expect(() => constantTimeEquals('short', 'a-much-longer-value')).not.toThrow();
    expect(constantTimeEquals('short', 'a-much-longer-value')).toBe(false);
  });

  it('handles multi-byte input without throwing', () => {
    expect(constantTimeEquals('सीक्रेट', 'सीक्रेट')).toBe(true);
    expect(constantTimeEquals('सीक्रेट', 'सीक्रेट!')).toBe(false);
  });
});

describe('verdict shape (Q6)', () => {
  it('refusals always carry code + status + message', () => {
    const verdict = verifyIngress(INGRESS_SPECS.whatsapp, { headers: {}, rawBody: RAW }, undefined);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(Object.keys(verdict).sort()).toEqual(['code', 'message', 'ok', 'status']);
      expect(verdict.message).toContain('fail-closed');
    }
  });

  it('success carries nothing but ok:true', () => {
    const verdict = verifyIngress(
      INGRESS_SPECS.telegram,
      { headers: { 'x-telegram-bot-api-secret-token': 'k' } },
      'k'
    );
    expect(verdict).toEqual({ ok: true });
    expect(Object.keys(verdict)).toEqual(['ok']);
  });
});
