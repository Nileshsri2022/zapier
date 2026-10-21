import { refuse, verifyIngress } from './engine';
import {
  catchHookHmacSpec,
  catchHookLegacySpec,
  catchHookOpenSpec,
  catchHookStaticSpec,
  gmailPushSpec,
  githubSpec,
  legacyWebhookSpec,
  telegramSpec,
  whatsappSpec,
} from './specs';
import type { IngressRequest, IngressVerdict } from './types';

/**
 * One named entry per ingress, so a call site never picks a spec by hand and
 * never has to know a header name. These are lookups, not implementations —
 * all behaviour lives in the engine.
 */

export function verifyGithub(request: IngressRequest, secret: string | undefined): IngressVerdict {
  return verifyIngress(githubSpec, request, secret);
}

export function verifyWhatsapp(
  request: IngressRequest,
  secret: string | undefined
): IngressVerdict {
  return verifyIngress(whatsappSpec, request, secret);
}

export function verifyTelegram(
  request: IngressRequest,
  secret: string | undefined
): IngressVerdict {
  return verifyIngress(telegramSpec, request, secret);
}

export function verifyGmailPush(
  request: IngressRequest,
  secret: string | undefined
): IngressVerdict {
  return verifyIngress(gmailPushSpec, request, secret);
}

/**
 * Catch hook (T5). The hook's `authMode` selects the spec:
 *   'none'   → the audited open spec (the call site passes no secret)
 *   'static' → shared-secret comparison
 *   'hmac'   → sha256 signature over the raw body
 *   absent   → legacy implicit: signature OR static key
 */
export function verifyCatchHook(
  request: IngressRequest,
  options: { authMode?: string; secret?: string } = {}
): IngressVerdict {
  const mode = (options.authMode ?? '').trim().toLowerCase();
  if (mode === 'none') return verifyIngress(catchHookOpenSpec, request, undefined);
  if (mode === 'static') return verifyIngress(catchHookStaticSpec, request, options.secret);
  if (mode === 'hmac') return verifyIngress(catchHookHmacSpec, request, options.secret);
  // An authMode nobody recognizes is a configuration error — it must not fall
  // through to the legacy implicit spec, which is an audited open door.
  if (mode) {
    return refuse('UNSUPPORTED_AUTH_MODE', `catch-hook: unsupported authMode "${mode}"`, 401);
  }
  return verifyIngress(catchHookLegacySpec, request, options.secret);
}

/**
 * Legacy trigger endpoint, which passes the signature as an argument rather
 * than a header. Kept behaviour-identical: unconfigured secret refuses.
 */
export function verifyLegacyWebhook(
  payload: string,
  signature: string | undefined,
  secret: string | undefined
): IngressVerdict {
  return verifyIngress(
    legacyWebhookSpec,
    { rawBody: payload, headers: { 'x-webhook-signature': signature } },
    secret
  );
}
