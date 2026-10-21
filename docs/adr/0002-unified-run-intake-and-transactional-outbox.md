# Unified Run Intake and Transactional Outbox Across All Triggers

## Context
ZapMate supports eight distinct trigger families across multiple runtime processes: `apps/hooks` (Webhook, WhatsApp, Telegram, Google Calendar push), `apps/server` (Gmail push/webhook, GitHub webhook, Schedule cron), and `apps/processor` (Google Sheets poller, Google Calendar poller). Previously, some triggers executed actions inline with partial action support while others wrote `ZapRun` rows without `ZapRunOutbox` or without event deduplication.

## Decision
Every trigger ingress funnels into a single deep module, `@repo/runs` (`enqueueRun`), which atomically checks `Zap.isActive`, claims an optional Redis deduplication key (`SET NX PX` with 24-hour TTL, fail-open on Redis outage), writes `ZapRun` and `ZapRunOutbox` in one database transaction, and attempts a bounded 3-second Kafka dispatch (`zap-events`) with fallback to `drainOutbox()` in `apps/processor`.

Why:
- **Single execution engine**: Every trigger—whether webhook, OAuth push, schedule, or poller—produces identical `ZapRun` state and executes through `apps/worker` with full retry, filter, step-condition, and step-output chaining support.
- **At-least-once durability**: Writing `ZapRun` and `ZapRunOutbox` in the same transaction prevents orphaned runs when Kafka is transiently unreachable.
- **Idempotent provider ingress**: Provider redeliveries (Meta, Telegram, Google push, GitHub, client `event_id` webhooks) are deduplicated before run creation, and failed DB transactions release their dedup claim so retries are not dropped.

## Consequences
- Trigger ingress handlers never write `ZapRun` or `ZapRunOutbox` rows directly; they only verify, hydrate, and call `enqueueRun`.
- Downstream action execution in `apps/worker` operates under an at-least-once delivery contract.
