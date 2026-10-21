# Actions Are A Catalog, Not A String List

## Context

"Which actions can this system execute?" had five answers:

| file | answer |
|---|---|
| `apps/worker/src/utils/actionTypes.ts` | 5 exact types + **2 prefixes** (`WhatsApp`, `Telegram`) |
| `apps/worker/src/index.ts` | a 7-branch if-cascade, three of them *before* the guard |
| `apps/server/src/seed.ts` | 7 `{type, image}` rows, kept in sync by a **comment** |
| `apps/web/components/modal/constants.ts` | 11 apps matched by `exact`/`prefix` |
| `apps/web/components/Modal.tsx` | a second list, and a form switch |

Nothing forced them to agree. Two defects followed from that:

- **Prefix matching made typos dispatch.** `isKnownActionType('WhatsApp Sendd')`
  was `true` and fell into the WhatsApp executor, which cannot tell the two
  names apart — the failure surfaced later, somewhere else.
- **The guard sat inside the retry closure.** An unknown action type is a
  deterministic failure, yet it burned three attempts and two backoff sleeps
  before reporting it.

And the catalog itself was not consulted: the seed comment claimed every entry
was worker-executable, but the claim was unverifiable by construction.

## Decision

### `@repo/actions` — data only

A dependency-free package (`APP_META`, `ACTION_CATALOG`, lookups). No Prisma, no
Node APIs, no runtime dependencies: the web bundle imports it.

- **`APP_META` owns the per-app display data** (`name`, `image`). The image
  belongs to the surface, not to each action — repeating `/apps/*.svg` per entry
  is exactly how the copies drifted.
- **`ActionEntry`** is `{ type, app, formKey, executorKey, aliasOf? }`.
  `executorKey` is explicit even though it equals `app` today: the moment one
  surface grows a second executor, deriving it from the app would route both to
  the same code with no type error.
- **`formKey`** documents which form the action uses. `Modal.tsx` still switches
  on type strings; because `formKey` is a union, moving that switch onto it is a
  compile-checked change rather than a silent gap. `'none'` means "needs no
  configuration" and is unused today — it keeps "no form" a representable answer.
- **Aliases are first-class entries.** `WhatsApp` and `Telegram` are accepted
  (old Zaps hold those names) but flagged `aliasOf` the canonical type.
  `offeredActions()` filters them out, so **accepted ≠ offered**: the seed and
  the picker see one entry per action, while the worker resolves the full table.
- **No prefix matching.** `findAction` is exact and case-sensitive.

### Worker — `actionRegistry.ts`

- **`EXECUTORS`** is `satisfies Record<ExecutorKey, ActionExecutor>`, so a
  missing executor is a **compile error**; the runtime suite then proves the
  reverse direction (no executor the catalog cannot reach).
- **Three named retry policies**: `none` (webhook — the receiver may already
  have processed the request, idempotency is its job), `email` (only
  `EmailActionError` with `retryable`), `action` (default). `withRetry` counts
  *attempts*, not retries: `maxRetries: 1` is a single try.
- **AI Transform has no policy.** Its step loop returns and owns its own
  `RetryResult`; wrapping it would multiply the budget. Absence of `policy` is
  the encoding of that, not a fourth policy.
- **The lookup happens before any retry.** An unknown type fails once with
  `attempts: 0` and a message listing the accepted types — the list comes from
  the catalog, so it cannot go stale.

### Server — seed derives, removal list stays

`SEEDED_ACTIONS` is `offeredActions()` mapped to `{type, image: APP_META[…].image}`.
`UNIMPLEMENTED_GMAIL_ACTIONS` stays in `seed.ts`: it is a **removal** list (find
rows, deactivate armed Zaps, prune), the opposite question to "which actions
exist". The server suite asserts the two sets stay disjoint — an entry in both
would be seeded and immediately purged.

### Web — grouping derives, forms stay UI

`APPS` keeps its hand-chosen order, but the seven action apps derive `types`,
`name` and `icon` from the catalog once at module load. Trigger apps (Gmail,
Sheets, Calendar, GitHub, Schedule) are not actions and keep their prefix rules;
`exact` is gone because nothing needs it any more.

## Behaviour changes (deliberate)

- **A prefix-but-not-exact type is refused**: `'WhatsApp Sendd'` now fails with
  "unknown action type", where it used to dispatch to the WhatsApp executor. Any
  such Zap was already running something arbitrary; failing loudly is the fix.
- **Unknown actions fail in one attempt**, not three.
- **Drive-by fix in `Modal.tsx`:** the A6 Telegram Send form sat after an
  identical `startsWith('Telegram')` trigger branch, so it could never render and
  Telegram actions fell through to "No configuration needed". It now sits in the
  action switch, where the action path routes.

## Alternatives considered

- **Worker-only registry.** Fixes the guard↔dispatch drift and leaves the seed
  and the web copying the list — three of the five copies survive.
- **Executors in the shared package.** Impossible: they need Prisma and Node,
  and the web bundle imports the same table.
- **Keep prefix matching as `matches(type)` per entry.** That reintroduces the
  convention that made typos dispatch; explicit aliases say what is accepted.
- **`executorKey` derived from `app`.** True today, silently wrong on the first
  second executor for a surface.
- **Catalog entries with `executorKey: 'unimplemented'`.** That is the
  "catalog outruns the worker" bug the equality test exists to prevent.

## Consequences

- Adding an action is one catalog entry plus one executor. The seed, the guard,
  the unknown-type message and the picker all follow; a missing executor or an
  orphan executor fails a test (or the compiler).
- The worker's `utils/actionTypes.ts` is gone; `index.ts` keeps a re-export so
  the run loop and its tests have one import site.
- Tests: `packages/actions/tests/catalog.test.ts` (data invariants: uniqueness,
  alias targets, accepted-vs-offered), `apps/worker/tests/actionRegistry.test.ts`
  (coverage both directions, the three policies, unknown types before any
  retry), and the server seed test (disjoint from the removal list).
