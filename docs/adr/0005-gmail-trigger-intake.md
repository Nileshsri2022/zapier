# Gmail Trigger Intake Owned By One Module

## Context

"Turn a Gmail notification into ZapRuns" was spread across three files:

- `apps/server/src/services/GmailDispatch.ts` — an 803-line grab-bag with eight
  exports: the payload builder, the per-message dispatch, mailbox resolution,
  history-record mapping, the history delta, the legacy relay event,
  watch renewal and the polling fallback. Two of its exports
  (`buildGmailRunPayload`, `mapHistoryRecords`) had no consumer outside it.
- `apps/server/src/controllers/GmailWebhookController.ts` — decoded the Pub/Sub
  envelope, then routed five legacy relay shapes through five near-identical
  `try/catch` handlers that each called `processGmailTrigger`.
- `apps/server/src/controllers/GmailTriggersController.ts` — CRUD handlers plus
  `processGmailTrigger`, a 45-line pipeline that resolved the server, mapped the
  event type and dispatched. A create/read/update/delete controller owned half
  the delivery path, and the webhook controller imported it *from another
  controller*.

Consequences worth naming: the same event had two entry points with different
resolution rules (id first, then email vs. email only), so "what happens on a
Gmail notification" could not be answered by reading one file; and the delivery
rules could only be tested by going through an HTTP mock or by importing a
dispatch function that production code no longer called directly.

## Decision

Two server-internal modules, and controllers that only do their own job.

### `apps/server/src/services/gmailIntake.ts` — delivery → ZapRuns

- **Interface:** `intakeGmailDelivery(delivery, deps?) → { runsEnqueued }`. This
  is the only entry point ingress calls.
- **The delivery is a discriminated union.** `{ source: 'pubsub'; emailAddress;
  historyId }` or `{ source: 'legacy'; emailAddress; event }`. A Pub/Sub
  notification with no cursor and a relay event with no message are not
  representable, instead of being rejected downstream after partial work. A
  runtime guard refuses an unknown `source` for untyped callers.
- **It owns the whole pipeline:** resolve servers by `emailAddress`, read the
  history delta and advance the cursor (or take the relayed message), hydrate
  once per message, match each Gmail trigger, dedup, and hand the payload to
  `@repo/runs`. `dispatchGmailEvent` and `resolveGmailServersByEmail` are
  module-private; `mapHistoryRecords` and the §4.3 payload builder live here.
- **Return value is a count, not a tuple of counters:**
  `{ runsEnqueued }`, so ingress can log `gmail intake` with
  `{ emailAddress, runsEnqueued }` and tests assert one number.
- **An unknown mailbox is a warn, not an error.** Log
  `{ emailAddress, reason: 'no_active_server' }` and return zero runs: no server
  exists now and none will appear on redelivery, so a retry only poison-loops.
- **The matching read stays unbounded.** `gmailTrigger.findMany` has no `take`
  — the single-Zap path this replaced must not leave an implicit `LIMIT 1`
  behind, and a test pins three triggers on one mailbox to three runs.
- **The dedup key is `${zapId}:${messageId}:${eventType}`, commented as such:**
  `zapId` alone suffices because a Zap has exactly one trigger, so the trigger
  row and its server are implied. Message + event kind keep a redelivery
  idempotent while letting a later star still fire.
- **Deps seam, worker-style:** `deps.createService ?? createGmailService`. Tests
  inject a fake Gmail client instead of mocking a module path.

`GmailErrorHandler` is consumed through `GmailService`, not owned or folded in
here: retry/classification belongs to the provider client.

### `apps/server/src/services/gmailWatch.ts` — the channel stays alive

- `renewExpiringGmailWatches(deps?)` and `pollActiveGmailServers(deps?)`, called
  only by `routes/CronRoutes.ts`.
- **`GMAIL_WATCH_RENEWAL_WINDOW_HOURS = 24`** (and its derived `_MS`) is a named
  constant: the window must stay larger than the cron interval, or a watch can
  lapse between sweeps.
- **Each renewal commits its own `GmailWatch` row** as it succeeds. A failing
  mailbox cannot roll back the renewals that already committed.
- `deps.now` exists so the horizon is tested against a pinned clock, not with
  fake timers.

### Controllers

- `GmailWebhookController` verifies (ADR-0002), decodes the envelope into one
  `GmailDelivery`, calls intake, answers 200 — or 401/400/500 for the wire
  failures. It no longer imports another controller.
- `GmailTriggersController` is CRUD only.

`GmailDispatch.ts` and its test file are deleted.

## The legacy relay path

Four relay shapes (`eventType` + `messageId`) still decode into a `legacy`
delivery, because deleting a delivery path is a product decision with production
blast radius, not a refactor side effect. Making it a union member keeps it
visible: it is one branch and one ADR line away from deletion once a usage probe
confirms nothing depends on it.

Shape validation collapsed into one required field (`emailAddress`; `messageId`
for legacy, `historyId` for Pub/Sub). The old handlers also skipped a relay
label event that omitted `labelIds`; that guard is gone because hydration
decides matching from the message's real labels, not from the notification's
echo of them.

## Alternatives considered

- **Keep `GmailDispatch` and export a `handleDelivery` from it.** The name and
  the eight exports are the problem; keeping the file keeps the grab-bag.
- **A shared `@repo/gmail` package for the delivery union and payload builder.**
  Only the server imports them, and the worker sends mail without reading the
  Gmail payload. A package with one importer is a package for its own sake.
- **Fold `GmailErrorHandler` into intake.** It is the provider client's retry
  policy; intake would then own two responsibilities.
- **Delete the legacy relay branch in this change.** Cheaper by forty lines,
  and a silent behaviour change for any custom relay still in production.
- **Keep the package-private dispatch functions exported for tests.** That is
  how the two entry points appeared in the first place; the tests now enter
  through `intakeGmailDelivery`.

## Consequences

- One place answers "what happens when a Gmail notification arrives", and it is
  not a controller.
- Intake and watch are tested at their own seam — a fake Gmail client and a
  pinned clock — with HTTP reduced to the verify/decode contract
  (`webhook-ingress.test.ts`) and the two sweeps pinned against their windows
  (`watch.test.ts`).
- Server suite: 384 → 394 tests across one fewer suite; `GmailDispatch` (803
  lines) is gone.
- Removing the legacy relay is now: delete one union member, one `toDelivery`
  branch, one intake branch, and its tests.
