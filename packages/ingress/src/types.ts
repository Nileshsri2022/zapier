/**
 * Ingress verification — one engine, six provider adapters.
 *
 * Every webhook-facing surface in ZapMate (GitHub, WhatsApp, Telegram, Gmail
 * push, the catch hook and the legacy trigger endpoint) used to carry its own
 * copy of HMAC/token comparison. Those copies disagreed on the decision that
 * matters: two compared with `===` (a timing oracle), and Telegram admitted a
 * request outright when its secret was unset. This module owns that decision
 * once.
 *
 * Vocabulary (see /codebase-design): this is a **deep module** — the interface
 * is `verifyIngress(spec, request, secret)`, and behind it sit constant-time
 * comparison, header normalisation, digest computation, policy defaults and
 * status mapping. Each provider contributes a **spec** (data), not a function,
 * so a divergent implementation cannot grow back.
 *
 * Policy: fail closed. A missing secret refuses unless the spec is registered
 * with the audited `allowOpenWhenUnconfigured` escape hatch.
 */

export type IngressProvider =
  | 'github'
  | 'whatsapp'
  | 'telegram'
  | 'gmail-push'
  | 'catch-hook'
  | 'legacy-webhook';

export type IngressErrorCode =
  | 'SECRET_NOT_CONFIGURED'
  | 'MISSING_CREDENTIAL'
  | 'INVALID_CREDENTIAL'
  | 'UNSUPPORTED_AUTH_MODE';

export type IngressRefusalStatus = 400 | 401 | 403;

export type IngressVerdict =
  | { ok: true }
  | {
      ok: false;
      code: IngressErrorCode;
      status: IngressRefusalStatus;
      message: string;
    };

export interface IngressRequest {
  /** Raw request headers; lookups are case-insensitive. */
  headers: Record<string, string | string[] | undefined>;
  /**
   * Exact bytes received over the wire. Preferred for every HMAC: signing a
   * re-serialized body is a correctness hole (key order, whitespace, unicode
   * escaping all change the digest).
   */
  rawBody?: string;
  /** Parsed body — only consulted when a spec opts into `payload: 'json'`. */
  body?: unknown;
}

export type IngressScheme = 'hmac-sha256' | 'static-token' | 'either';

export interface IngressSpec {
  provider: IngressProvider;
  /** Header(s) carrying the presented credential, in priority order. */
  headers: readonly string[];
  /** How the presented credential is checked. */
  scheme: IngressScheme;
  /** HMAC only: expected prefix on the presented digest (e.g. `sha256=`). */
  digestPrefix?: string;
  /** HMAC only: digest encoding produced by the provider. */
  digestEncoding?: 'hex' | 'base64';
  /** HMAC only: what gets signed. Raw bytes unless a spec opts out. */
  payload?: 'raw' | 'json';
  /** Strip this prefix from the presented value before comparing. */
  stripPrefix?: string;
  /** Status returned on refusal (provider-specific; default 401). */
  refusalStatus?: IngressRefusalStatus;
  /**
   * AUDITED ESCAPE HATCH. When true, an unconfigured secret lets the request
   * through — the capability-URL behaviour the catch hook and the legacy
   * endpoint are specified to keep. Every open door must be listed here and in
   * ADR-0002; nothing else may set it.
   */
  allowOpenWhenUnconfigured?: boolean;
}
