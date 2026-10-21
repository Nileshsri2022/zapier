import crypto from 'crypto';
import type {
  IngressErrorCode,
  IngressRefusalStatus,
  IngressRequest,
  IngressSpec,
  IngressVerdict,
} from './types';

/**
 * The single cryptographic path every ingress uses.
 *
 * Nothing above this file compares secrets with `===`: `timingSafeEqual` plus
 * an explicit length check is the only comparison primitive, so a timing
 * oracle cannot reappear one provider at a time.
 */

/** Constant-time string comparison, safe for length mismatch. */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function refuse(
  code: IngressErrorCode,
  message: string,
  status: IngressRefusalStatus = 401
): IngressVerdict {
  return { ok: false, code, status, message };
}

/** Case-insensitive, array-tolerant header read; trims and drops empties. */
export function readHeader(headers: IngressRequest['headers'], name: string): string | undefined {
  const wanted = name.toLowerCase();
  let raw: string | string[] | undefined;
  for (const key of Object.keys(headers ?? {})) {
    if (key.toLowerCase() === wanted) {
      raw = headers[key];
      break;
    }
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** The bytes the provider actually signed. */
function signedPayload(spec: IngressSpec, request: IngressRequest): string {
  if (spec.payload === 'json')
    return typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
  return request.rawBody ?? '';
}

function digestFor(spec: IngressSpec, payload: string, secret: string): string {
  const digest = crypto.createHmac('sha256', secret).update(payload);
  const encoded = spec.digestEncoding === 'base64' ? digest.digest('base64') : digest.digest('hex');
  return spec.digestPrefix ? `${spec.digestPrefix}${encoded}` : encoded;
}

/**
 * Verify one ingress request against one spec.
 *
 * Order matters: an unconfigured secret is decided *before* the credential is
 * looked for, so an unconfigured provider can never be probed with candidate
 * secrets to distinguish "no secret" from "wrong secret".
 */
export function verifyIngress(
  spec: IngressSpec,
  request: IngressRequest,
  secret: string | undefined
): IngressVerdict {
  const status = spec.refusalStatus ?? 401;
  const resolved = secret?.trim();

  if (!resolved) {
    if (spec.allowOpenWhenUnconfigured) {
      // Catch-hook `none` mode is a deliberate public capability URL; the spec
      // name is surfaced so the door stays visible in logs.
      return { ok: true };
    }
    return refuse(
      'SECRET_NOT_CONFIGURED',
      `${spec.provider}: no secret configured — refusing the request (fail-closed)`,
      status
    );
  }

  const strip = (value: string) =>
    spec.stripPrefix && value.startsWith(spec.stripPrefix)
      ? value.slice(spec.stripPrefix.length).trim()
      : value;

  const hmacMatches = (presented: string) =>
    constantTimeEquals(strip(presented), digestFor(spec, signedPayload(spec, request), resolved));

  // 'either' is the legacy catch-hook shape: a signature if one is offered,
  // otherwise the shared secret as a static key. Header order is the contract.
  if (spec.scheme === 'either') {
    const [signatureHeader, ...staticHeaders] = spec.headers;
    const signature = signatureHeader ? readHeader(request.headers, signatureHeader) : undefined;
    if (signature) {
      if (hmacMatches(signature)) return { ok: true };
      return refuse('INVALID_CREDENTIAL', `${spec.provider}: invalid credential`, status);
    }
    for (const header of staticHeaders) {
      const presented = readHeader(request.headers, header);
      if (!presented) continue;
      if (constantTimeEquals(strip(presented), resolved)) return { ok: true };
      return refuse('INVALID_CREDENTIAL', `${spec.provider}: invalid credential`, status);
    }
    return refuse('MISSING_CREDENTIAL', `${spec.provider}: missing credential header`, status);
  }

  let presented: string | undefined;
  for (const header of spec.headers) {
    presented = readHeader(request.headers, header);
    if (presented) break;
  }

  if (!presented)
    return refuse('MISSING_CREDENTIAL', `${spec.provider}: missing credential header`, status);

  const matches =
    spec.scheme === 'hmac-sha256'
      ? hmacMatches(presented)
      : constantTimeEquals(strip(presented), resolved);

  if (!matches) return refuse('INVALID_CREDENTIAL', `${spec.provider}: invalid credential`, status);

  return { ok: true };
}
