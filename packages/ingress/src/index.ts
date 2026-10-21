/**
 * `@repo/ingress` — verification for every surface that admits a provider event.
 *
 * Before this module, six ingress paths each carried their own HMAC or token
 * comparison. They disagreed where it counts: Gmail push and the legacy trigger
 * compared with `===` (a timing oracle), Telegram admitted a request when its
 * secret was unset, and Gmail signed a re-serialized body instead of the bytes
 * Google signed. Those are now one engine and six declarative specs.
 *
 * Policy: fail closed. A provider with no secret refuses, unless its spec is
 * registered in `OPEN_WHEN_UNCONFIGURED` — an audited list, mirrored in
 * ADR-0002, holding only the deliberate capability-URL surfaces.
 */

export type {
  IngressErrorCode,
  IngressProvider,
  IngressRefusalStatus,
  IngressRequest,
  IngressScheme,
  IngressSpec,
  IngressVerdict,
} from './types';

export { constantTimeEquals, readHeader, refuse, verifyIngress } from './engine';

export {
  INGRESS_SPECS,
  OPEN_WHEN_UNCONFIGURED,
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

export { resolveAuthMode, resolveWebhookSecret } from './secrets';

export {
  verifyCatchHook,
  verifyGithub,
  verifyGmailPush,
  verifyLegacyWebhook,
  verifyTelegram,
  verifyWhatsapp,
} from './adapters';
