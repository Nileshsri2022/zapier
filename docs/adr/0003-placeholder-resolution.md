# Placeholder Resolution Owned By One Module

## Context

Every action needs the same rule: turn `{{a.b}}` / `{a.b}` in a step's stored
metadata into values from the run's metadata before executing. That rule had
six implementations, and they disagreed:

| Call site | Before this ADR |
| --- | --- |
| `apps/worker/src/sendEmail.ts` | normalised `{{x}}`→`{x}`, then called a shared single-brace walker |
| `apps/worker/src/sendWebhook.ts` | own walker + own normalisation + recursion, exported as `templateDeep` |
| `apps/worker/src/sendTelegram.ts` | own regex over both notations; trimmed keys |
| `apps/worker/src/sendWhatsApp.ts` | same regex plus a numeric-slot carve-out for Meta templates |
| `apps/worker/src/sendDiscord.ts` | per-field calls to the shared walker (single braces only) |
| `apps/server/src/controllers/GmailActionsController.ts` | flat `{{word}}` only — no dots, no single braces |
| `apps/worker/src/executeAiAction.ts`, `apps/worker/src/index.ts` (Solana) | shared single-brace walker |

Two consequences followed. First, the rule drifted: `{ name }` resolved in
three of six surfaces, `{{a.b}}` in five, dotted paths in six of seven.
Second, one class of bug could not be fixed locally — **issue #53**: the webhook
action hashed placeholders with a regex run over *serialized* JSON, so JSON's
own braces collided with placeholder braces (`{"text":"{value}"}` resolved to
nothing, a multi-key body resolved halfway), and a substituted value containing
`"` or a newline produced invalid JSON. Escaping could not fix that: the input
was already ambiguous.

## Decision

One deep module, `@repo/placeholders`, owns the rule.

- **One interface:** `resolvePlaceholders(value, runMetadata, { mode?, positional? })`.
  `mode` only decides the serialization boundary; the walking logic is shared.
- **Both notations, trimmed:** `{{a.b}}` (documented, what the builder and
  `docs/ask-matt/` emit) and `{a.b}` (legacy) resolve identically, everywhere.
  No migration script and no Zap rewrites: stored metadata is untouched.
- **JSON mode is a round trip:** a JSON string goes in, `JSON.parse` runs, the
  graph is resolved, `JSON.stringify` produces the output. Because
  serialization happens last, **the output cannot be invalid JSON** — quotes,
  backslashes, newlines and unicode in resolved values are handled by
  `JSON.stringify`, not by escaping code. Do not add escaping; it would
  double-encode.
- **Native types in JSON mode:** a placeholder that is the *whole* string keeps
  its type (`{"qty":"{qty}"}` → `{"qty":3}`); an embedded one stays a string
  (`"Order {qty} items"` → `"Order 3 items"`).
- **One pass, never re-resolved:** a resolved value containing `{admin.password}`
  is emitted literally. Run data is attacker-influenced; re-resolving would let
  it reference fields the Zap author never wrote.
- **Unresolved stays literal.** A missing path — or a `null`/`undefined` value —
  leaves the placeholder text in place, so downstream validation (`isAddress`,
  URL parsing) fails loudly instead of sending an empty string and reporting
  success. No `strict` option: the seam exists, nothing needs it yet.
- **Typed refusal:** invalid JSON in `json` mode throws
  `PlaceholderError('INVALID_JSON')`. The module knows nothing about
  `WebhookActionError` / `EmailActionError` / `AiStepError`; each caller maps the
  error into its own taxonomy, and therefore its own retry policy.

`utils/replaceKeys.ts` and every private resolver are deleted — no shim, for the
same reason ADR-0002 deleted `webhookAuth.ts`: a shim keeps the old interface
alive and lets a future call site reach around the module.

## Alternatives considered

- **Keep per-caller resolvers and share a helper.** That is what
  `utils/replaceKeys.ts` already was: four of seven call sites used it, and the
  other three grew their own. A shared helper does not survive local pressure to
  special-case one action.
- **Regex over serialized JSON with escaping.** Ambiguous by construction —
  JSON's braces and placeholder braces are the same characters. This is issue
  #53's root cause.
- **Two entry points (`resolveText` / `resolveJson`).** The walking logic is
  identical; two names would drift the moment one is patched and the other is
  not.
- **Rewrite stored `{single}` templates to `{{double}}`.** High risk, zero
  user-visible gain, and it cannot reach Zaps already in flight.

## Consequences

- A resolution bug is fixed once and every action inherits it. A new action gets
  the rule, both notations, JSON safety and the injection guarantee for free.
- **Behaviour change (deliberate):** with `bodyMode: 'json'`, a body that is not
  valid JSON now fails the step (`Body is not valid JSON — …`) instead of being
  posted verbatim. Posting non-JSON to an endpoint declared JSON was already a
  misconfiguration; the failure is visible once and actionable.
- **Widenings (no action needed):** `{{double}}` now resolves in Discord, and
  dotted paths now resolve in the server Gmail action.
- Semantics live in one table (~40 rows: notation, three/four braces,
  injection, JSON typing and round-trips, recursion, positional slots,
  invalid JSON). Caller suites keep only their own contracts — email address
  validation after resolution, webhook SSRF/auth, Discord field caps, WhatsApp
  param counts.
- Deploy ordering: `build:packages` builds this before either app, so there is
  no rollout ordering risk between `apps/worker` and `apps/server`.
