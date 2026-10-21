import type { IngressSpec } from './types';

/**
 * The six adapters, as data.
 *
 * Every entry states: where the credential lives, how it is computed, what is
 * signed, and whether an unconfigured secret may open the door. Nothing here
 * implements comparison — that is the engine's single job.
 *
 * Read the `allowOpenWhenUnconfigured` values as an audit list. Two entries
 * carry it:
 *
 *   - `catch-hook-open`  — T5 `authMode: 'none'`: a public capability URL is a
 *     specified feature, not an oversight.
 *   - `legacy-github`    — GitHub currently verifies only when a secret is
 *     configured (T4 §5 says it should always verify). Closing this door is a
 *     separate ticket: it needs a per-Zap secret generator in the builder so
 *     existing Zaps keep working. Listed here so the gap is visible.
 */

/** GitHub: HMAC over raw bytes, `sha256=<hex>` in `x-hub-signature-256`. */
export const githubSpec: IngressSpec = {
  provider: 'github',
  headers: ['x-hub-signature-256'],
  scheme: 'hmac-sha256',
  digestPrefix: 'sha256=',
  payload: 'raw',
  refusalStatus: 401,
  // See file header: temporary, and the only reason T4 §5 is not yet enforced.
  allowOpenWhenUnconfigured: true,
};

/** WhatsApp / Meta: HMAC over raw bytes, `sha256=<hex>` in `x-hub-signature-256`. */
export const whatsappSpec: IngressSpec = {
  provider: 'whatsapp',
  headers: ['x-hub-signature-256'],
  scheme: 'hmac-sha256',
  digestPrefix: 'sha256=',
  payload: 'raw',
  refusalStatus: 401,
};

/**
 * Telegram: the secret token is compared directly (it is not a digest of the
 * body). Previously this path returned "allowed" when the secret was unset —
 * the accidental fail-open this module closes.
 */
export const telegramSpec: IngressSpec = {
  provider: 'telegram',
  headers: ['x-telegram-bot-api-secret-token'],
  scheme: 'static-token',
  refusalStatus: 401,
};

/** Gmail push: HMAC over raw bytes in `x-goog-signature` (hex, no prefix). */
export const gmailPushSpec: IngressSpec = {
  provider: 'gmail-push',
  headers: ['x-goog-signature'],
  scheme: 'hmac-sha256',
  digestEncoding: 'hex',
  payload: 'raw',
  refusalStatus: 401,
};

/** Catch hook, `authMode: 'hmac'` — `x-webhook-signature: sha256=<hex>` over raw body. */
export const catchHookHmacSpec: IngressSpec = {
  provider: 'catch-hook',
  headers: ['x-webhook-signature'],
  scheme: 'hmac-sha256',
  digestPrefix: 'sha256=',
  payload: 'raw',
  refusalStatus: 403,
};

/** Catch hook, `authMode: 'static'` — `x-webhook-secret` or `Authorization: Bearer`. */
export const catchHookStaticSpec: IngressSpec = {
  provider: 'catch-hook',
  headers: ['x-webhook-secret', 'authorization'],
  scheme: 'static-token',
  stripPrefix: 'Bearer ',
  refusalStatus: 401,
};

/**
 * Catch hook, `authMode: 'none'` — deliberately open. The call site passes no
 * secret for this mode, so the engine only ever reaches its escape hatch (an
 * unconfigured secret), never a credential comparison.
 */
export const catchHookOpenSpec: IngressSpec = {
  provider: 'catch-hook',
  headers: [],
  scheme: 'static-token',
  refusalStatus: 401,
  allowOpenWhenUnconfigured: true,
};

/**
 * Catch hook with no `authMode` (legacy implicit): accept EITHER a valid
 * `sha256=` signature OR the shared secret as a static key, and stay a
 * capability URL when nothing is configured.
 */
export const catchHookLegacySpec: IngressSpec = {
  provider: 'catch-hook',
  headers: ['x-webhook-signature', 'x-webhook-secret', 'authorization'],
  scheme: 'either',
  digestPrefix: 'sha256=',
  stripPrefix: 'Bearer ',
  payload: 'raw',
  refusalStatus: 401,
  allowOpenWhenUnconfigured: true,
};

/** Legacy trigger endpoint: same `sha256=` HMAC scheme, 401 on refusal. */
export const legacyWebhookSpec: IngressSpec = {
  provider: 'legacy-webhook',
  headers: ['x-webhook-signature'],
  scheme: 'hmac-sha256',
  digestPrefix: 'sha256=',
  payload: 'raw',
  refusalStatus: 401,
};

/** Audited registry — every spec the engine can be pointed at. */
export const INGRESS_SPECS = {
  github: githubSpec,
  whatsapp: whatsappSpec,
  telegram: telegramSpec,
  'gmail-push': gmailPushSpec,
  'catch-hook-hmac': catchHookHmacSpec,
  'catch-hook-static': catchHookStaticSpec,
  'catch-hook-open': catchHookOpenSpec,
  'catch-hook-legacy': catchHookLegacySpec,
  'legacy-webhook': legacyWebhookSpec,
} as const satisfies Record<string, IngressSpec>;

/**
 * The audit table: every spec that may admit a request whose provider has no
 * secret configured. Asserted by the test suite so a new open door cannot be
 * added without editing this list (and ADR-0002).
 */
export const OPEN_WHEN_UNCONFIGURED: readonly string[] = [
  'catch-hook-open',
  'catch-hook-legacy',
  'github',
];
