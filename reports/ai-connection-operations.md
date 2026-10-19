# AI Transform: operations and acceptance

**Implementation complete (2026-10-19); production acceptance remains gated.**
PC/P1/P3/P2/P4/P5 implement encrypted compatible connections, safe transport, four adapters, worker execution, shared budgets, save validation, discovery/preview/probe APIs, catalog/icon, editor, conditional routing, tests and deployment documentation. Puter is experimental and **disabled by default**. No migration, paid request or production activation was performed during implementation.

## Deployment order and configuration

1. Review owner policies and external gates below. Install/build using the repository workspace conventions. Generate a **normal engine-enabled Prisma client** for real database use; an engine-free client used for local mocked checks is insufficient.
2. Back up staging, review additive migration `20261019130000_ai_connections`, and deploy through the normal process:
   ```sh
   npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
   npx prisma generate --schema packages/db/prisma/schema.prisma
   ```
   Never use `migrate reset` on retained data. Existing migration history must already be valid; these tests do not repair unrelated historical migrations.
3. Deploy credential/egress configuration, shared packages and worker first, then server validation/APIs, then seed the catalog (`npm run seed -w server`), then web. Seeding is explicit, not automatic. Verify the six-action executable-registry invariant before exposure.
4. Configure **both API and worker identically**. Configure deployment secrets in a secret manager, never Git, logs, chat or shell arguments:
   - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`: platform credentials. Set each enabled provider's `AI_MODEL_ALLOWLIST_OPENAI` / `AI_MODEL_ALLOWLIST_ANTHROPIC`, and optionally `AI_DEFAULT_MODEL_OPENAI` / `AI_DEFAULT_MODEL_ANTHROPIC`. Models/prices are not assumed current. Models using unsupported temperature/token parameters must not be allowlisted.
   - `AI_DEFAULT_PROVIDER`: optional preferred configured provider. With no default model, editor selects the first explicitly allowlisted model; the server does not silently invent a provider default.
   - `AI_CONNECTION_ENCRYPTION_KEYS`: JSON key ID → canonical base64 **32-byte** random key. `AI_CONNECTION_ACTIVE_KEY_ID`: active ID. Keep recovery custody separate from DB backups.
   - `AI_COMPATIBLE_ALLOWED_HOSTS`: exact approved public DNS hostnames, comma-separated; no wildcard, port, IP or path. Empty denies compatible endpoints. HTTPS:443 and bounded versioned API paths only.
   - `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: same budget store on API and worker. Defaults: 200 calls/owner/UTC day, global cap off (`AI_DAILY_CALL_CAP_PER_USER=200`, `AI_DAILY_CALL_CAP_GLOBAL=0`). Set a reviewed finite global cap before public rollout. `AI_BUDGET_FAIL_OPEN=false` is the default. Setting both caps to zero explicitly disables quota enforcement.
   - Hard ceilings may be reduced: `AI_MAX_INPUT_CHARS=20000`, `AI_MAX_OUTPUT_TOKENS=2000`, `AI_TIMEOUT_MS=60000`, `AI_MAX_RESPONSE_BYTES=1048576`. Default output is 500 tokens; editor respects a lower operator cap.
   - `JWT_SECRET` and exact `FRONTEND_URL` / `CORS_ORIGIN` allow cookie authentication and session-bound AI CSRF protection. Do not wildcard credentialed CORS.
5. Web: set the production public API origin using existing `NEXT_PUBLIC_API_URL` configuration. Development uses same-origin `/api` rewritten to server-only `API_SERVER_URL` (default local port 5000), so browsers never call sandbox-localhost. HTTPS proxy previews need the actual web origin allowed by API CORS. Next dev allows `*.e2b.app`.

Server and worker Dockerfiles include shared AI packages. Docker builds were not executed here. The Puter adapter requires a verified **Node.js 22+** execution environment; do not assume the existing Bun container proves SDK compatibility.

## Editor and APIs

Select **AI → AI Transform**. Modes: summarize, classify (2–20 categories), extract (up to 25 named typed fields), custom (literal instructions, optional structured fields). Input templates alone are substituted; preview sample is literal. Category/field output is validated locally, never executed as a tool. Downstream references include `{previousOutput.output}`, `{previousOutput.fields.category}`, or `{stepOutputs.1.fields.summary}`.

Each action has **Only run action if…** conditions, persisted on create/edit and evaluated by the existing worker with AND semantics. Negative-sentiment routing: AI classify, then Webhook/WhatsApp with field `previousOutput.fields.category`, operator `equals`, value `negative`. Skipping the final action completes the run rather than leaving it running. This is conditional execution, not a visual branch graph. Edit/reopen preserves saved AI metadata and trigger payload settings.

| Endpoint | Behavior |
|---|---|
| `GET /api/actions/ai/models` | Safe configured-provider/model discovery and limits; no secrets |
| `GET /api/ai/csrf` | No-store session-bound token, 30-minute expiry |
| `POST /api/actions/ai/test` | Literal sample + config; shared credentials, validation, quota and provider executor; no ZapRun |
| `GET/POST /api/ai/connections` | Owned list/create; credentials write-only |
| `PATCH /api/ai/connections/:id` | Replace safe settings/key; omitted key remains unchanged |
| `DELETE /api/ai/connections/:id` | Soft revoke; `{revoked:true, affectedZapCount}` scoped to owner |
| `POST /api/ai/connections/:id/test` | Explicit model + fixed small test input (≤64 output tokens, operator cap respected); **billable** and quota-reserved |

AI endpoints require authentication. Cookie mutations need `X-AI-CSRF` from the authenticated CSRF endpoint; mixed cookie/Bearer requests still require it. Bearer-only clients without an auth cookie can mutate without the cookie token. UI fetches a fresh token before each mutation and **does not automatically retry paid tests**. Missing/foreign/revoked connections are indistinguishable. Connection create/edit checks DNS but makes no model call; successful save is not proof of provider compatibility. Metadata validation strips unknown fields, including accidentally supplied secrets. AI connection names/URLs and provider errors are never HTML-rendered. General pre-existing Zap APIs retain their existing authentication behavior; this is not a site-wide CSRF retrofit.

## Billing, privacy and reliability

Input goes to the selected service and possibly an underlying aggregator model provider. Owner approval is required before mapping sensitive/regulated data. Input/output remain in existing run metadata/history; set an appropriate deployment retention policy. Prompt framing is not a prompt-injection guarantee. Do not wire AI classifications directly into financial transfers without separate controls.

Each attempt reserves one quota unit atomically for owner + global UTC-day counters (48-hour expiry). Reservations have a five-second wait cap and default fail-closed on Redis outage. Attempts are not refunded on ambiguous failure or later egress rejection; this is a conservative call counter, not a billing ledger. Preview/probe/retries/repair share it. Worker initial requests retry transient errors up to three total attempts; schema repair gets one dispatch and is never retried after ambiguous failure (at most four dispatches/execution). Usage is summed only when reported by successful responses; missing token counts are not invented.

A fresh pending run strips ingress-supplied `stepOutputs`/`previousOutput` before becoming running, so trigger JSON cannot spoof paid-step replay. Later worker-persisted stage output is reused before credential/budget lookup on replay. Crash before persistence and concurrent duplicate delivery can still re-bill; exactly-once paid execution is **not** promised. Revocation stops future resolution, not an already dispatched call. Generic downstream Webhook template interpolation retains existing string/JSON semantics; scalar category/number/boolean mappings are safest. A typed-template redesign is out of scope.

## Compatible transport and capability review

Profiles: `chat_json_schema`, `chat_json_object`, `chat_prompt_json`; all validate structured output locally. No capability probing, profile fallback, arbitrary auth headers or Responses API support. Review each provider/model/profile explicitly.

Transport re-resolves A/AAAA before every dispatch, rejects mixed/public-private, mapped/transition/reserved/documentation destinations, pins the validated IP while retaining original Host/TLS servername and certificate verification, disables pooling and follows no redirects. Deadline includes DNS; request/streamed-response bounds are 1 MiB; exported singleton allows 10 in-flight requests/process. This concurrency limit is **not** a distributed quota. Add network egress controls and verify live TLS/proxy behavior before enabling any host.

## Key rotation and incident response

1. Add a new random key ID; retain old versions. Deploy expanded keyring to every reader, then switch active ID.
2. Back up DB; verify custody/recovery of old keys.
3. From `apps/server`, dry run `npx tsx src/scripts/rotateAiConnectionKeys.ts`.
4. Apply with `npx tsx src/scripts/rotateAiConnectionKeys.ts --apply`. It prints aggregate counts only and compare-and-swaps identity/key ID/update time to avoid overwriting concurrent replacement.
5. Repeat until old-version records, **including revoked rows**, are handled. Retained backups may still require old keys; remove versions only under an approved recovery policy.

During a leak revoke the connection **and** rotate/revoke the upstream credential; deleting locally cannot recall a dispatched request. Encryption does not protect a compromised reader holding the keyring.

## Puter activation gate

Pinned SDK **2.6.4**, isolated worker thread, restricted environment, suppressed SDK output, memory/IPC bounds, termination on timeout/completion. `AI_PUTER_ENABLED=false` until verified. Enabling also requires `PUTER_AUTH_TOKEN`, `AI_MODEL_ALLOWLIST_PUTER`, selected/default model and Node.js 22+.

Owner must verify unattended account authorization, token expiry/refresh/revocation, account billing/quota, retention/underlying-provider suitability, real SDK initialization/result normalization, output-token enforcement and timeout termination behavior. SDK buffers its response; IPC/memory bounds do **not** establish a streaming response-byte cap inside the SDK. Puter is not described as unlimited/free. Source inspection and mocks are not live acceptance.

## Verification commands

Mocked/offline regression checks (no paid calls):

```sh
npm test -w @repo/ai-connections
npm test -w @repo/ai
npm test -w server -- --runInBand
npm test -w worker -- --runInBand
npm test -w web
npm run build -w web
```

Gated **real** tests are outside Jest and skipped unless explicitly enabled:

```sh
npm run test:ai:e2e -w server
# After injecting disposable staging settings through your secret manager:
RUN_AI_DB_E2E=1 RUN_AI_REDIS_E2E=1 npm run test:ai:e2e -w server
RUN_E2E=1 AI_E2E_PROVIDERS=openai,anthropic,openai_compatible npm run test:ai:e2e -w server
# Puter separately, only after its gates and explicit staging enablement:
RUN_E2E=1 AI_E2E_PROVIDERS=puter npm run test:ai:e2e -w server
```

Every enabled real test requires `AI_E2E_ACK_TEST_ENV=I_ACCEPT_TEST_ONLY`.

- **DB smoke**: engine-enabled Prisma, `DATABASE_URL` naming a disposable `test`/`e2e` DB with migration already deployed. Verifies migration record, actual encrypted CRUD, owner isolation, DB provider/FK constraints, rotation/revocation; removes only its own temporary users/rows. It uses random in-memory test encryption keys and fake provider secrets; it does not apply migrations itself.
- **Redis concurrency**: dedicated test Upstash settings, 40 competing reservations across two owners, asserts global/per-owner limits and TTL. Uses unique temporary keys and deletes them; no provider calls.
- **Workflow**: running API, processor, worker, Kafka, Redis and the same disposable DB. `AI_E2E_API_URL` must be a localhost or explicitly named test/staging host; `AI_E2E_TOKEN` is a disposable user's Bearer token. No token/secret is printed. Choose allowed test models with `AI_E2E_MODEL_OPENAI`, `AI_E2E_MODEL_ANTHROPIC`, `AI_E2E_MODEL_OPENAI_COMPATIBLE`, `AI_E2E_MODEL_PUTER` or use discovery defaults. Compatible needs an existing owned `AI_E2E_CONNECTION_ID`; harness does not delete that supplied connection.
- Harness starts an HTTP receiver on `0.0.0.0:19095` (`AI_E2E_RECEIVER_PORT` override); for a remote worker set `AI_E2E_RECEIVER_URL` to its reachable test/proxy origin. Localhost default works only when worker can reach that listener. Set `AI_E2E_WEBHOOK_SECRET` to match API ingress signature policy if enabled. Ensure the processor drain is scheduled, or supply `AI_E2E_PROCESSOR_URL` and `CRON_SECRET` for an explicit authenticated drain.
- Workflow test creates/enables a temporary Zap through real APIs; sends negative and positive fixtures through webhook → outbox → Kafka → worker → provider → receiver; asserts parsed category/provider, reported usage when available, rejection of spoofed ingress step outputs, conditional delivery/non-delivery and terminal completion. It disables/deletes its Zap/runs afterward. Failures may leave resources if API teardown itself fails: inspect only the disposable environment, never production. Each fixture can incur retries/repair charges.

Passing skipped tests proves **nothing** about live providers, database migrations, Redis atomicity or production deployment.

## Rollback and external acceptance checklist

Disable affected Zaps first, stop new paid tests, remove the provider from discovery configuration on API/worker (Puter flag false; compatible approved-host list empty), and revoke upstream credentials if necessary. Removing the allowlist does not recall in-flight requests. Keep the additive table and recovery keys; never drop credentials as a rollback shortcut. Revert/redeploy application changes through the normal release process; do not expose an AI catalog to old workers that cannot execute it. Existing Gmail single-engine routing has no inline toggle; see its separate rollout spec.

- [x] Code, mocked tests, gated harness and operational documentation implemented.
- [ ] Engine-enabled Prisma + staging migration/CRUD smoke, restore rehearsal and key rotation rehearsal.
- [ ] Real Redis concurrency test and outage behavior in deployed services.
- [ ] Real OpenAI/Anthropic/enabled-compatible workflow and live TLS/egress/profile verification.
- [ ] Puter SDK/runtime/lifecycle/billing/normalization verification before activation.
- [ ] Owner privacy/retention/billing/model/host approval, controlled catalog rollout and rollback rehearsal.
- [ ] Gmail production migration/backfill, audit, Pub/Sub/watch renewal and live mail checks (separate prerequisite rollout; routing code already exists).

See [implementation spec](ai-reasoning-step-spec.md), [completion evidence](ai-implementation-completion.md), and [Gmail routing spec](gmail-worker-routing-spec.md).
