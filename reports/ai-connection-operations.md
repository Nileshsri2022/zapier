# AI connection foundation: operations

Status: connection CRUD, encryption, safe transport and mocked tests implemented.
P1 adds the shared AI executor, provider adapters, budgets and worker dispatch, **not seeded or exposed in the editor**.
Preview/probe, server action validation and editor integration are not implemented yet.
No migration is applied automatically by this change.

## Build and migration

Use the repository's Bun workspace install/build conventions. The shared package can also be built with:

```sh
npm run build --workspace @repo/ai-connections
```

The server Dockerfile builds and includes it. Before deploying connection APIs, review and run the additive migration against a staging database, then production using the normal deployment process:

```sh
npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
npx prisma generate --schema packages/db/prisma/schema.prisma
```

Never use `migrate reset` against retained data. A real PostgreSQL migration/CRUD smoke test remains required before production; unit/API tests use injected or mocked persistence.

## Configuration

- `AI_CONNECTION_ENCRYPTION_KEYS`: JSON object mapping key IDs to canonical base64-encoded **32-byte** random keys, e.g. deployment secret containing `{"v1":"<base64 key>"}`. Do not paste keys into chat, Git, logs or shell command arguments.
- `AI_CONNECTION_ACTIVE_KEY_ID`: key ID used for new/replaced credentials.
- `AI_COMPATIBLE_ALLOWED_HOSTS`: comma-separated exact public hostnames. Empty denies creation/resolution. No wildcards, paths, ports or IP literals. Prefer a very small reviewed provider list.

Generate a key within your secret-management environment using a cryptographically secure source. Keep backup and recovery custody separate from database backups. Server and future worker must share the same policy/keyring. Missing/malformed encryption settings fail closed; malformed configured settings fail server startup. Unconfigured AI does not prevent unrelated server features from starting.

## APIs in this foundation

`GET/POST /api/ai/connections`, `PATCH/DELETE /api/ai/connections/:id`.
All require an authenticated **Bearer token**. Cookie authentication is deliberately rejected for now, including mixed cookie/Bearer requests, until an editor CSRF flow is implemented. API limiter applies at the existing `/api` mount. POST/PATCH bodies use strict bounded schemas. API keys are write-only; omission on PATCH means unchanged. DELETE soft-revokes and returns 204. Affected-Zap reporting is deferred to action integration.

The connection body bypasses HTML sanitization because credentials are opaque; strict schema validation applies instead. Never use HTML rendering for connection names/URLs. No key suffix, ciphertext or key ID is returned. Errors never expose upstream/crypto/database details. Every operation is scoped to the authenticated owner; missing/foreign/revoked records are indistinguishable.

Connection creation/edit validates public DNS but makes **no AI request**. Probe and test-step endpoints will be added only with shared budgeting. Do not treat saving a connection as proof of provider compatibility or successful authentication.

## Rotation and revocation

1. Add a new random key under a new ID; retain all old key versions.
2. Deploy the expanded keyring to every credential reader, then switch the active key ID everywhere.
3. Back up the database and verify recovery access to the old keys.
4. Dry-run decryption/re-encryption from `apps/server`:
   `npx tsx src/scripts/rotateAiConnectionKeys.ts`.
5. Apply with `npx tsx src/scripts/rotateAiConnectionKeys.ts --apply`. Only aggregate counts are printed. Updates compare `id`, `keyId`, and `updatedAt` to avoid overwriting concurrent key replacements.
6. Repeat dry-run/apply until no old-version records remain (including revoked rows). Investigate failures without exposing records or secrets.
7. Remove old key versions only after confirming all live readers and retained records/backups have an approved recovery plan. A backup encrypted with old keys still needs those keys.

Connection deletion prevents future resolution, not a request already dispatched. During an incident, revoke/rotate credentials at the upstream provider as well. Encryption at rest does not protect a compromised server with access to the keyring.

## Outbound transport constraints

The shared transport uses HTTPS on 443, exact approved hosts and versioned base paths, per-request A/AAAA checks, and rejects non-public/reserved/mapped/transition addresses. It connects directly to the validated IP while setting the original TLS servername and Host, retains certificate validation, disables socket pooling and does not follow redirects. Bounds: 60-second maximum wall time including DNS, 1 MiB request/response limits, 10 in-flight requests per transport instance. The exported singleton supplies process-local concurrency control; it is not a distributed quota.

Use network egress policy as defense in depth. Test against an approved staging provider before enabling execution. The mocked tests verify request construction and failure boundaries; they do not replace a live TLS/proxy/network review. The transport is internal-only; raw returned provider bodies must never be logged or returned as errors. Capability profile IDs describe protocol modes, not a certification of a particular provider/model.

## Verification

```sh
npm test --workspace @repo/ai-connections
npm test --workspace server -- --runInBand tests/ai/connections.test.ts
```

Production gates still open: real PostgreSQL migration test, live TLS/egress verification, provider-specific capability review, budgeted executor, and owner privacy/billing sign-off. Puter and the AI catalog are not exposed by this foundation.

## P1 worker execution (not catalog-enabled)

Build dependencies in order: `@repo/ai-connections`, `@repo/ai`, then worker. The worker Dockerfile includes both packages. The shared Prisma adapter now lives in `@repo/ai-connections` so server and worker enforce identical owner checks.

- Direct OpenAI/Anthropic require the selected platform key plus `AI_DEFAULT_MODEL_<PROVIDER>` (unless a model is selected per step) and `AI_MODEL_ALLOWLIST_<PROVIDER>`. No draft/model-example IDs or prices are hard-coded; operators must verify supported models. Baseline request profiles use system messages, temperature and `max_tokens`; incompatible models fail clearly rather than retrying unsupported parameters.
- Compatible BYOK requires an active owner-scoped saved connection, explicit model and approved host. `chat_json_schema`, `chat_json_object` and `chat_prompt_json` profiles select a single format, without runtime capability probing or fallback.
- Puter uses pinned SDK `2.6.4` in a worker thread with isolated environment, suppressed SDK output, memory limits and termination on timeout/completion. Node.js **22+** is required for this adapter. `AI_PUTER_ENABLED` defaults false. Account suitability, retention, billing, token lifecycle, real SDK response shapes and provider-side output caps still require staging verification. The SDK buffers its response; IPC size and worker memory bounds do **not** establish a streaming response-byte limit inside the SDK. Leave disabled until accepted.
- `AI_MAX_INPUT_CHARS` defaults/maxes to 20,000; output-token default 500, hard maximum 2,000; per-request timeout maximum 60 seconds and response bytes maximum 1 MiB. Operators may reduce limits. Only Input is templated; owner instructions are literal. Framing escapes input markers, but is not a guarantee against prompt injection.
- The existing retry helper preserves legacy behavior for other actions and now supports an opt-in predicate. AI transient initial attempts retry up to three total attempts. Schema validation gets one repair dispatch; a failed/ambiguous repair is fatal, not retried. At most four provider dispatches can occur in one worker execution (three initial attempts plus one repair), each with its own quota reservation. Reported usage from successful provider responses, including invalid output, is accumulated; unavailable counts are not invented.
- Budgets use one atomic Redis Lua reservation for per-owner and global UTC-day counters, with 48-hour expiry. Defaults: 200/user/day, global off. Tests and retries will share this policy when preview APIs land. Redis reservation wait is capped at five seconds; default fail-closed prevents dispatch. Fail-open is explicit and warns without sensitive details. Reservations are conservative and are not refunded automatically, including ambiguous failures or a later outbound preflight rejection. This is an attempt limit, not a billing ledger. Live Redis concurrency verification remains a staging gate.
- Stored stage-output presence is checked before configuration/credentials/budget lookup. Replay reuses it. The crash-before-persistence window and concurrent duplicate delivery can still cause duplicate provider billing; exactly-once execution is not promised.

The worker still persists results through the existing stage-output path. Updating dynamic import extensions exposed a pre-existing Webhook response typo (`result.data` versus the actual `result.response`); that one-line correction preserves downstream response chaining and lets worker typechecking succeed.

P1 checks:

```sh
npm test --workspace @repo/ai
npm test --workspace worker -- --runInBand
```

No live API calls or billable staging workflows were run during implementation. P1 remains pending real-provider acceptance. Next is P3 server metadata validation, provider/model discovery and budgeted previews, **before** P2 catalog enablement.
