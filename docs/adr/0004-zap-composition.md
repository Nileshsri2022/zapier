# Zap Composition Owned By One Module

## Context

A **Zap** is one trigger plus an ordered list of action steps, and most trigger
kinds need a provider-specific *shadow row* (`GmailTrigger`, `ScheduledTrigger`,
`WhatsAppTrigger`, `GoogleCalendarTrigger`, …) that the ingress reads. That
knowledge had no module:

- `createZap` (`apps/server/src/controllers/ZapController.ts`) was a ~300-line
  handler holding **six inline trigger-kind branches**, each repeating the same
  shape: read `triggerMetaData`, check the connection belongs to the caller,
  create the shadow row. Webhook and GitHub correctly create none — an implicit
  seventh case expressed as "no `if` matched".
- `deleteZapWithId` enumerated the same kinds **again** to tear them down. The
  two lists had already drifted: create called `tx.whatsAppTrigger.create`
  directly while teardown called `(tx as any).whatsAppTrigger?.deleteMany?.()` —
  defensive casts because the two sites disagreed about which models exist.
- A trigger type with no matching branch composed a Zap **successfully** whose
  shadow row was never written, so the trigger could never fire. The user saw a
  green checkmark and silence; diagnosing it meant reading the source.

Composition was also only testable through `supertest` against a mocked Prisma
client, so the rules themselves — which rows, in what order, inside what
transaction — had no test surface of their own.

## Decision

One server-internal deep module, `apps/server/src/services/zapComposition.ts`,
owns what a Zap is made of.

- **Interface:** `composeZap(draft, { userId }) → { zapId }` and
  `removeZap(zapId, { userId }) → { deletedZap }`. Both own their transaction.
- **Its own vocabulary.** `ZapDraft` is `{ triggerId, triggerMetadata, steps }`
  with `steps: { actionId, metadata, stepConditions }[]`. The controller maps
  `CreateZapSchema`'s HTTP shape into it explicitly (not by spread), so a rename
  in the zod schema cannot silently change composition. Metadata is
  `Record<string, unknown>`: the module *stores* step metadata, it does not
  interpret it — interpretation happens at run time through
  `@repo/placeholders`.
- **Validation before the transaction.** Immediate trigger lookup, action
  metadata validation, then the kind's own validation (ownership, cron,
  required metadata), then one transaction for the writes. A bad cron or a
  foreign connection cannot leave partial rows behind.
- **Adapters are data, and answer both directions.** Each `TriggerAdapter`
  declares `validate`, `createShadowRow` and `deleteShadowRows`. A kind cannot
  be half-implemented, and teardown can no longer drift from creation. Webhook
  and GitHub use an explicit `none` adapter — a real object, not a null check,
  so compose and teardown take the same path for every kind.
- **`kindOf` is an explicit table**, not prefix matching. A future
  `Gmail Calendar Sync` is either mapped deliberately or refused; `startsWith`
  would quietly pick a side. Unrecognised types throw `TRIGGER_KIND_UNKNOWN`
  instead of composing a dead Zap.
- **Typed refusals:** `ZapCompositionError` with codes `UNKNOWN_TRIGGER`,
  `TRIGGER_KIND_UNKNOWN`, `INVALID_CRON`, `INVALID_TRIGGER_METADATA`,
  `INVALID_ACTION_METADATA`, `MISSING_CONNECTION`, `CONNECTION_NOT_OWNED`. The
  controller maps codes to statuses; it never string-matches a message.
- **Teardown order is explicit:** outbox → runs → shadow rows → gmail action
  rows → trigger → steps → zap. Children before parents, with a test that
  asserts the recorded call order rather than just the calls.

`ZapController` drops from 684 to 378 lines and becomes an HTTP shell:
parse → map to `ZapDraft` → compose → map failures to statuses.

## Status codes

- **411 stays** for validation failures (`UNKNOWN_TRIGGER`, `INVALID_CRON`,
  `INVALID_TRIGGER_METADATA`, `INVALID_ACTION_METADATA`, `MISSING_CONNECTION`).
  It is not the semantic HTTP code for validation, but it is what this endpoint
  has always returned and what clients key off; changing it would be a silent
  contract break with no benefit. Do not "fix" this to 400.
- **`CONNECTION_NOT_OWNED` → 403.** Previously a foreign connection surfaced as
  an opaque 400 ("Failed to create a zap!") indistinguishable from a server
  bug; the user now gets an answer they can act on.
- **`TRIGGER_KIND_UNKNOWN` → 422.** The request is well-formed; the server
  cannot process what it names.

## Alternatives considered

- **Keep the branch chain and extract a helper per kind.** That is what the
  handler effectively was — helpers called inline. The teardown list still lives
  somewhere else, and nothing forces the two to agree.
- **Put composition in a shared package (`@repo/zaps`).** Only the server
  composes Zaps; seeds write the catalog only. One importer is a package for the
  sake of a package (YAGNI). Extract when a second consumer appears.
- **Derive the kind with `startsWith`.** Cheaper to write, and silently wrong the
  first time two kinds share a prefix.
- **Throw on unknown kinds only in development.** A dead Zap is a production
  failure, not a developer-experience one.

## Consequences

- A new trigger kind is one adapter plus one table entry — not a handler edit
  and a matching teardown edit 200 lines away.
- **Behaviour change (deliberate):** composing a Sheets/Calendar trigger with
  missing metadata, or any trigger with an unmapped type, now **fails** instead
  of producing a Zap that never fires. This is the dead-Zap bug being closed.
- **Behaviour change:** an unowned connection returns **403**, not 400.
- `(tx as any)?.deleteMany?.(…)` is gone: each adapter references its model
  statically, so the row lists are typed.
- Composition is tested at its own seam with an order-recording fake
  transaction; HTTP tests assert only status mapping. The kind-specific suites
  (`schedule-creation`, `im-trigger-creation`) now drive `composeZap` directly.
- Out of scope: `updateZapWithId` replaces action steps only and has no per-kind
  branching. If it grows any, it comes here.
