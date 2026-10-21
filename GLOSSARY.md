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

## Gmail Trigger

A mailbox-sourced trigger (`Gmail New Email`, `Gmail Labeled`, `Gmail Starred`, or `Gmail From Sender`) that hydrates a Google mailbox event and initiates a ZapRun when its filter predicates match.
_Avoid_: email listener, inbox poller.

## Google Sheets Trigger

A spreadsheet-sourced trigger (`Google Sheets Updated Row`) that detects newly appended or in-place modified rows in a target worksheet and emits one ZapRun per changed row.
_Avoid_: sheet listener, spreadsheet webhook.

## Google Calendar Trigger

A calendar-sourced trigger (`Google Calendar New Event`, `Event Updated`, `Event Start`, `Event Ended`, `Event Cancelled`, `New Calendar`, or `Event Matching Search`) that initiates a ZapRun from calendar lifecycle changes or upcoming event windows.
_Avoid_: meeting alarm, calendar bot.

## GitHub Trigger

A repository webhook trigger (`GitHub Push`, `GitHub Pull Request`, `GitHub Issue`, or `GitHub Release`) that verifies a GitHub event delivery and initiates a ZapRun with normalized repository and actor metadata.
_Avoid_: git hook, GitHub poller.

## Webhook Trigger

An inbound HTTP trigger (`AvailableTriggers.type = "Webhook"`) that accepts an arbitrary JSON payload for a specific Zap, optionally verifies its shared secret or HMAC signature, and hands it to run intake.
_Avoid_: catch hook, custom endpoint.

## WhatsApp Trigger

An inbound messaging trigger (`WhatsApp Message Received`) that receives a Meta Cloud API webhook for a connected business phone number and initiates a ZapRun with sender and message metadata.
_Avoid_: WhatsApp listener, phone webhook.

## Telegram Trigger

An inbound bot trigger (`Telegram New Message`) that receives a Telegram update for a specific registered bot, optionally filters by slash command, and initiates a ZapRun.
_Avoid_: Telegram poller, chat listener.

## Schedule Trigger

A time-based recurring trigger (`Schedule Every Minute`, `Schedule Every Hour`, `Schedule Every Day`, `Schedule Every Week`, or `Schedule Every Month`) that initiates a ZapRun whenever its wall-clock `nextRunAt` slot becomes due.
_Avoid_: timer step, delay action.

## AI Transform Action

An executable reasoning action step (`AvailableActions.type = "AI Transform"`) that runs a structured `summarize`, `classify`, `extract`, or `custom` transformation over trigger and prior-step data and exposes its typed output envelope to downstream steps.
_Avoid_: LLM node, prompt step.

## Email Action

An executable action step (`AvailableActions.type = "Email"`) that interpolates dynamic placeholders into a recipient address, subject, and body and delivers a transactional email.
_Avoid_: mailer trigger, SMTP hook.

## Solana Action

An executable action step (`AvailableActions.type = "Solana"`) that interpolates recipient address and SOL amount placeholders and submits a confirmed native SOL transfer on the Solana network.
_Avoid_: crypto trigger, wallet listener.

## Webhook Action

An executable action step (`AvailableActions.type = "Webhook"`) that dispatches an outbound HTTP request (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`) with interpolated URL, headers, and JSON body to an external endpoint.
_Avoid_: inbound hook, webhook trigger.

## WhatsApp Action

An executable action step (`AvailableActions.type = "WhatsApp Send Message"`) that interpolates recipient phone number and message text and delivers an outbound message via the Meta WhatsApp Cloud API.
_Avoid_: WhatsApp bot, SMS action.

## Telegram Action

An executable action step (`AvailableActions.type = "Telegram Send Message"`) that interpolates target chat ID and message text and delivers an outbound message via the Telegram Bot API.
_Avoid_: Telegram webhook, bot trigger.

## Discord Action

An executable action step (`AvailableActions.type = "Discord Send Message"`) that posts plain text or rich embed messages to a Discord channel via an incoming webhook URL.
_Avoid_: Discord bot, Discord integration step.
