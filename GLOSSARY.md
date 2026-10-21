# Glossary

Domain terms used across the codebase. Prefer these names in code, reports and
architecture reviews.

## Zap

A user-owned automation: one trigger plus an ordered list of actions. A Zap is
either active or inactive; only active Zaps produce runs.

## ZapRun

One execution of a Zap, created by trigger ingress and advanced by the worker
stage by stage. `status` moves `pending → running → completed | failed`.
`pending` means "durably recorded, not yet picked up".

## Zap composition

The single module (`apps/server/src/services/zapComposition.ts`) that turns a
**ZapDraft** into rows: the Zap, its trigger, its ordered steps, and the
provider-specific shadow row the trigger kind needs. It owns validation
(ownership, cron, required trigger metadata) *before* any write, and it owns
teardown in the same adapters, so creation and deletion cannot drift apart.

_A trigger kind is an adapter and a table entry. A type with no adapter is
refused — never composed into a Zap that can't fire._

## Run intake

The single deep module (`@repo/runs`) every trigger uses to turn a provider
event into a durable ZapRun. It owns the active-Zap check, the optional dedup
claim, the ZapRun + ZapRunOutbox transaction, the best-effort immediate
dispatch, and the outbox drain. Callers pass a Zap id, metadata and an optional
`{scope, key}` dedup identity; they never write run rows themselves.

## Outbox

`ZapRunOutbox` rows: one per run that still needs dispatching. The row is
written in the same transaction as its ZapRun, deleted after a successful
Kafka publish, and retained as the fallback when the publish fails. The
processor drains leftovers. Delivery is therefore at-least-once.

## Trigger ingress

The edge that verifies and hydrates a provider event before handing it to run
intake: hooks webhooks, Telegram, WhatsApp, Google Calendar push, the server
webhook and Gmail routes, cron schedules, GitHub webhooks, and integration
pollers.

## Gmail trigger intake

The single deep module (`apps/server/src/services/gmailIntake.ts`) that turns one
Gmail **delivery** into ZapRuns. A delivery is a discriminated union:
`{source: 'pubsub'}` carries a mailbox + history cursor, `{source: 'legacy'}`
carries a relayed message. The module resolves the mailbox's servers, reads the
delta, hydrates each message, matches each Gmail trigger, dedups, and hands the
payload to **run intake**; it returns `{runsEnqueued}`. The watch lifecycle
(renewal, polling fallback) is its own module (`gmailWatch.ts`), because keeping
the channel alive is a different question from routing one delivery.

_Callers decode the wire envelope and hand over one delivery; they never resolve
servers, hydrate, or match triggers themselves._
_Avoid_: "Gmail dispatch" — that name belonged to the grab-bag this replaced._

## Placeholder resolution

The single deep module (`@repo/placeholders`) that turns `{{a.b}}` / `{a.b}` in
a step's stored metadata into values from run metadata before an action
executes. It owns both notations, dotted paths, recursion through objects and
arrays, the JSON round trip (parse → resolve → stringify, so output is always
valid JSON), and the rule that an unresolved reference stays literal. Resolved
values are never re-resolved, so run data cannot inject a reference.

_Callers keep their own vocabulary and validation; they never walk metadata
themselves. Adding an action does not add a resolver._
_Avoid_: "templating engine", "field mapper" as separate things — there is one rule._

## Ingress verification

The single deep module (`@repo/ingress`) that decides whether an inbound
provider event is authentic. It owns the constant-time comparison, the
fail-closed default (an unconfigured secret refuses), the refusal codes and
statuses, and the raw-bytes-vs-reserialized distinction. Callers name their
provider — `verifyGithub`, `verifyWhatsapp`, `verifyTelegram`, `verifyGmailPush`,
`verifyCatchHook`, `verifyLegacyWebhook` — and receive one verdict, never a
boolean, and never compare a credential themselves.

_An ingress that admits requests without a configured secret is listed in
`OPEN_WHEN_UNCONFIGURED` and in ADR-0002; adding one is an auditable act, not a
local decision._

## Action catalog

The single table (`@repo/actions`) that answers "which actions exist?":
`APP_META` (per-surface name and icon), `ACTION_CATALOG` (one entry per accepted
type: app, form, executor key, optional alias) and `offeredActions()` — the
canonical subset the seed writes and the picker shows. The worker's executors are
keyed by `executorKey`, so the dispatcher, the catalog and the seed cannot drift
without a test or a compiler error.

_Accepted ≠ offered: a legacy alias dispatches exactly like the type it names,
but is never seeded or shown._
_Avoid_: "known action types" as a second list — there is one table._

## Discord Action

An executable action step (`AvailableActions.type = "Discord Send Message"`) that posts plain text or rich embed messages to a Discord channel via an incoming webhook URL.
_Avoid_: Discord bot, Discord integration step.

