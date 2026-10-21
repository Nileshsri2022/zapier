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

## Discord Action

An executable action step (`AvailableActions.type = "Discord Send Message"`) that posts plain text or rich embed messages to a Discord channel via an incoming webhook URL.
_Avoid_: Discord bot, Discord integration step.

