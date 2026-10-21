# Ingress Verification Owned By One Module

## Context

Six ingress surfaces each carried their own credential check, hand-copied and
independently evolved:

| Surface | Call site | Check before this ADR |
| --- | --- | --- |
| Catch hook (`/hooks/:userId/:zapId`) | `apps/hooks/src/catchHook.ts` | `webhookAuth.verifyWebhookRequest` — 4 auth modes, HMAC or static key |
| Telegram | `apps/hooks/src/telegramHandler.ts` | `verifyTelegramSecretHeader` — **returned `true` when the secret was unset** |
| WhatsApp | `apps/hooks/src/whatsappHandler.ts` | `verifyWhatsAppSignature` — HMAC over raw body, fail closed |
| Gmail push | `apps/server/src/controllers/GmailWebhookController.ts` | HMAC over `JSON.stringify(req.body)` — not the bytes Google signed |
| Legacy server webhook | `apps/server/src/controllers/TriggerController.ts` | `verifyWebhookSignature` — `===` comparison, verified only when a secret was configured |
| GitHub | `apps/server/src/routes/GitHubRoutes.ts` | inline HMAC, verified only when a secret was configured |

Two defects recurred across them, and neither was visible from any single call
site:

1. **Accidental fail-open.** Telegram's unset secret meant "allowed". A bot
   registered without a secret token accepted every delivery, and the shape of
   the bug (`if (!secret) return true`) reads like a guard.
2. **Wrong bytes hashed, and non-constant-time comparison.** Gmail hashed a
   re-serialized body, so a correctly signed delivery could fail. The legacy
   webhook compared digests with `===`, which is a timing oracle.

The cost was leverage: a fix that was correct in one surface told you nothing
about the other five, and each new ingress started by copying the nearest
neighbour.

## Decision

One deep module, `@repo/ingress`, owns every ingress verification decision.

- **The interface is small and named per provider.** Call sites call
  `verifyGithub`, `verifyWhatsapp`, `verifyTelegram`, `verifyGmailPush`,
  `verifyCatchHook` or `verifyLegacyWebhook` and receive one verdict:
  `{ok: true} | {ok: false, code, status, message}`. Codes are
  `SECRET_NOT_CONFIGURED`, `MISSING_CREDENTIAL`, `INVALID_CREDENTIAL`,
  `UNSUPPORTED_AUTH_MODE`.
- **The adapters are data, not code.** Each provider is an `IngressSpec` in
  `packages/ingress/src/specs.ts` stating where the credential lives, how it is
  computed, what is signed (`raw` bytes or a JSON body), the refusal status, and
  whether an unconfigured secret may admit the request. One engine
  (`verifyIngress`) interprets every spec, so the six surfaces cannot drift.
- **Fail-closed is the module's default.** With no secret configured, the
  request is refused before the credential is even looked for — an unconfigured
  provider cannot be probed to distinguish "no secret" from "wrong secret".
- **Constant-time comparison is mandatory.** `constantTimeEquals` (with an
  explicit length guard) is the only comparison primitive in the module.
  Nothing above it is allowed to compare a credential with `===`.
- **`webhookAuth.ts` is deleted.** No re-export shim: a shim would keep the old
  interface alive and let a future call site reach around the module. All six
  call sites were migrated in the same change.
- **Gmail signs raw bytes.** The HMAC covers `req.rawBody`, the bytes the
  sender signed, never `JSON.stringify(req.body)`. (Pub/Sub OIDC remains a
  separate ticket; this ADR covers the legacy HMAC path.)

### The audit table: who may open when unconfigured

`OPEN_WHEN_UNCONFIGURED` in `packages/ingress/src/specs.ts` is the complete
list of specs that admit a request whose provider has no secret. The test suite
asserts it, so a new open door requires editing both the list and this ADR.

| Spec | Open when unconfigured | Why |
| --- | --- | --- |
| `catch-hook-open` | **Yes** | `authMode: 'none'` — a deliberately public capability URL. The unguessable URL is the gate, by spec. |
| `catch-hook-legacy` | **Yes** | Legacy implicit mode: a hook with no `authMode` and no secret anywhere keeps working as a capability URL, exactly as before. Changing it would break every existing unsigned hook. |
| `github` | **Yes (transitional)** | GitHub verifies only when `WEBHOOK_SECRET` or a per-Zap secret is configured. Always-verify is the goal, but it needs a per-Zap secret generator in the builder so existing Zaps continue to deliver. Listed here so the gap stays visible and is closed by its own change. |
| `whatsapp`, `telegram`, `gmail-push`, `catch-hook-static`, `catch-hook-hmac`, `legacy-webhook` | No | Fail closed. |

Telegram moved from fail-open to fail-closed as part of this decision: a bot
with no secret token now refuses deliveries. Its handler tests were rewritten
to configure a secret and a regression pins the 401 with no enqueue.

## Consequences

- A verification defect is fixed once, in one file, and every surface inherits
  it. A new ingress adds a spec object and a one-line adapter, not a
  comparison routine.
- The five existing specs keep their observable refusal statuses (401, except
  `catch-hook-hmac`'s 403), so wire contracts and the specs under
  `docs/ask-matt/` are unchanged.
- Call sites still resolve *which* secret applies (`resolveWebhookSecret`,
  `resolveAuthMode`); the module decides *whether* the request is authentic.
  Policy about a specific provider's history stays at the edge where it is
  visible, not buried in shared code.
- Telegram deployments without a secret token stop receiving updates until the
  secret is set. This is the intended fix, not a regression.
- Out of scope, and worth its own ticket: `apps/hooks/src/googleCalendarHandler.ts`
  performs no verification at all (it reads `X-Goog-Channel-ID` and trusts it) —
  a seventh ingress surface that this module can accept once its spec is agreed.
