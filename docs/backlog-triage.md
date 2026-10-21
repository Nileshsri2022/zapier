# Backlog triage — 2026-10-21

Nine open issues were verified against `main` after PR #64 merged. All nine describe behaviour that
is already correct; each entry names the test that proves it, so a reviewer re-runs one command
rather than trusting a claim.

This file exists because the sandbox token is a GitHub App installation without `issues:write`, so
the closure reasons could not be posted on the issues themselves. If that permission is ever granted,
`scripts/triage-backlog.sh --apply` posts the same evidence as comments.

## Verified fixed before this session

| Issue | Verdict | Proof |
| --- | --- | --- |
| [#51](../../issues/51) SSRF egress policy | fixed | `apps/worker/src/sendWebhook.ts` `assertAllowedTarget`: non-`http`/`https` protocols rejected (covers `file:`), loopback / link-local / `169.254.169.254` / `metadata.google.internal` / RFC1918 blocked. Test: `apps/worker/tests/sendWebhook.test.ts` → *blocks loopback, private and metadata targets unless explicitly allowed* |
| [#55](../../issues/55) signature over re-serialized body | fixed | `apps/hooks/src/index.ts` captures `req.rawBody` via the `express.json({ verify })` hook; `catchHook.ts` hands those bytes to the signature check. Test: `packages/ingress/tests/ingress.test.ts` → *rejects a signature computed over different bytes (no re-serialization)* |
| [#45](../../issues/45) `x-github-delivery` ignored | fixed | `apps/server/src/routes/GitHubRoutes.ts:203` reads the header and uses `deliveryId` (falling back to a body hash) as the run dedupe key. Test: `apps/server/tests/triggers/github-contract.test.ts` → *same delivery id redelivered → duplicate skipped, zero extra runs* |
| [#36](../../issues/36) WhatsApp/Telegram calls can hang | fixed | Both senders use `AbortController` + `setTimeout` and map `AbortError` to a typed failure. Test: `apps/worker/tests/outboundTimeouts.test.ts` → *sends through a bounded (abort-signalled) transport* |
| [#28](../../issues/28) Telegram fans out to every tenant's bot | fixed | Webhook is registered per bot (`/api/webhooks/telegram/${bot.id}`) and the handler scopes the lookup to `bot: { id: botId, isActive: true }`; an update without a bot id is acked without dispatching. Test: `apps/hooks/tests/telegramHandler.test.ts` → *only loads triggers for the bot that received the update* |

## Fixed by PR #64 (merged as `a32de17`)

| Issue | Verdict | Proof |
| --- | --- | --- |
| [#49](../../issues/49) filters accept any operator | fixed | `UpdateZapFiltersSchema` + `validateBody` on `PATCH /api/zaps/:zapId/filters`. Test: `apps/server/tests/zaps/zap-filters.test.ts` |
| [#50](../../issues/50) unknown operator evaluates as pass | fixed | `evaluateFilters` default branch returns `false` and logs at error level. Test: `apps/worker/tests/helpers.test.ts` → *when an operator cannot be evaluated* |
| [#54](../../issues/54) `commandArgs` keeps the `@botname` | fixed | Slice by the raw first token. Test: `apps/hooks/tests/telegramHandler.test.ts` → *strips the @botname mention from commandArgs* |
| [#56](../../issues/56) WhatsApp verify token fallback | fixed | No committed fallback; unset refuses with 403 and uses `constantTimeEquals`. Test: `apps/hooks/tests/whatsappHandler.test.ts` → *fails closed when no verify token is configured* |

[#58](../../issues/58) closed automatically by PR #64's `Closes #58`.

## Still open, not triaged

The remaining open backlog was not assessed in this pass. Two items were checked and left open on
purpose because they are genuine product decisions rather than bugs:

- **#44** (JWTs never expire, returned in the body, logout cannot revoke) — needs a session model
  decision: short-lived access + refresh, or server-side revocation. Not a mechanical fix.
- **#57** (email rate limit is one platform-wide bucket) — needs a rate-limit key decision
  (per tenant? per integration? per Zap?) before the code changes.

Everything else needs the same treatment these nine got: read the issue, verify it against `main`
first, and only then decide.
