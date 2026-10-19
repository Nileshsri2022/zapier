# Spec: AI Reasoning & Transformation Step

**Providers: OpenAI, Anthropic, Puter, and OpenAI-compatible connections**

| Item | Value |
| --- | --- |
| Roadmap | Most Commonly Used Next Triggers & Actions — Priority 1 |
| Repository | `Nileshsri2022/zapier` (ZapMate) |
| Working branch | `arena/31be57e9-zapier` |
| Revised | 2026-10-19 |
| Status | Revised specification only; implementation and production policy decisions await approval |
| Scope | New `@repo/ai`; worker execution; server validation, connections and preview APIs; editor forms; **Prisma migration for encrypted `AiConnection` records** |
| Related | `reports/workflow-execution-gaps.md`, `reports/gmail-worker-routing-spec.md` |

This revision incorporates Puter and user-owned OpenAI-compatible endpoints. It supersedes the previous no-migration, no-SDK, and deferred-BYOK decisions. Approval to revise this document is not approval to enable production billing or arbitrary outbound endpoints. Existing-code observations below are from the original 2026-10-18 audit; proposed features are not implemented.

## 1. Context — audit findings (current state, verified 2026-10-18)

### 1.1 How actions execute today

| Fact                                                                                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One action catalog: `AvailableActions { id, type @unique, image }`, 5 seeded types — `Email`, `Solana`, `WhatsApp Send Message`, `Telegram Send Message`, `Webhook`                                                                                                                                                                                        | `packages/db/prisma/schema.prisma` (`AvailableActions`), `apps/server/src/seed.ts` (`SEEDED_ACTIONS`)                                                                                                         |
| Hard invariant (from F3/F4): **every seeded action must be executable by the worker.** Unknown types throw and fail the run loudly — never fake-succeed                                                                                                                                                                                                    | `seed.ts` header comment; `apps/worker/src/utils/actionTypes.ts` (`isKnownActionType`, `KNOWN_ACTION_TYPES`, `KNOWN_ACTION_PREFIXES`); guard at top of `executeActionWithRetry` in `apps/worker/src/index.ts` |
| Worker dispatch is an if/else chain on `action.type` inside `executeActionWithRetry(actionType, metadata, zapRunMetadata, previousOutputs)`, wrapped by `withRetry({ maxRetries: 3, initialDelayMs: 1000 })`                                                                                                                                               | `apps/worker/src/index.ts` (~l.59–231)                                                                                                                                                                        |
| Per-step config lives unvalidated in `Action.metadata` (Json). `CreateZapSchema`/`UpdateZapActionsSchema` accept `actionMetaData: z.any()`; `createZap` stores it as-is                                                                                                                                                                                    | `packages/types/src/index.ts`; `apps/server/src/controllers/ZapController.ts` (`createZap`)                                                                                                                   |
| Step chaining already exists: `processMessage` persists each step's `output` to `ZapRun.metadata.stepOutputs[stage]`; downstream templates resolve `{previousOutput.x}` / `{stepOutputs.N.x}` via `replaceKeys` (nested dot paths); per-step `stepConditions` are evaluated by `evaluateFilters` against `{ ...zapMetadata, previousOutput, stepOutputs }` | `apps/worker/src/index.ts` (`replaceKeys` l.25, `processMessage`), `apps/worker/src/evaluateFilters.ts`, `Action.stepConditions` in schema                                                                    |
| `replaceKeys` returns `String(value)` — referencing a whole object yields `"[object Object]"`. Only scalar leaf paths are referenceable downstream; `evaluateFilters` also compares via `String()`                                                                                                                                                         | `apps/worker/src/index.ts` l.40; `evaluateFilters.ts` (`evaluateCondition`)                                                                                                                                   |
| `withRetry` retries **every** thrown error 3×. `isRetryableError` exists but is never consulted, and returning `{ success: false }` without throwing is recorded as success (the old D2 Solana bug)                                                                                                                                                        | `apps/worker/src/utils/retry.ts`                                                                                                                                                                              |
| Kafka consumption is at-least-once (`autoCommit: false`, offset committed after `processMessage`) — a stage can be re-processed after its output was already stored                                                                                                                                                                                        | `apps/worker/src/index.ts` (`startConsumer`)                                                                                                                                                                  |
| Outbound HTTP precedent is dependency-free: global `fetch` + `AbortController` timeout (30 s default), dynamic `import()` for per-action modules                                                                                                                                                                                                           | `apps/worker/src/sendWebhook.ts`; `sendWhatsApp`/`sendTelegram` dynamic imports in `index.ts`                                                                                                                 |
| Worker runs Node ≥18, has **no zod and no env validation** (reads `process.env` directly); server validates env via zod; missing-integration config fails loudly (Solana key precedent, F3)                                                                                                                                                                | `apps/worker/package.json`, `apps/worker/.env.example`, `apps/server/src/env.ts`, Solana branch in `apps/worker/src/index.ts`                                                                                 |
| Worker already depends on `@repo/redis`, `@repo/sentry`, `@repo/email`, `@repo/db`, `@repo/kafka` (shared-package pattern, `swc` build)                                                                                                                                                                                                                    | `apps/worker/package.json`, `packages/*/package.json`                                                                                                                                                         |

### 1.2 Trigger → worker reachability (which triggers can feed an AI step on day one)

| Trigger family                                          | Reaches `apps/worker`? | Path                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generic Webhook                                         | ✅                     | `apps/hooks` → Kafka `zap-events` (F2)                                                                                                                                                                                                                                                                                                                                                                                           |
| WhatsApp Message Received                               | ✅                     | `apps/hooks/src/whatsappHandler.ts` → Kafka; payload root keys incl. `text`, `from`, `caption`                                                                                                                                                                                                                                                                                                                                   |
| Telegram New Message                                    | ✅                     | `apps/hooks/src/telegramHandler.ts` → Kafka                                                                                                                                                                                                                                                                                                                                                                                      |
| GitHub (Push/PR/Issue/Release)                          | ✅                     | `ZapRunOutbox` in `apps/server/src/routes/GitHubRoutes.ts` → processor → Kafka                                                                                                                                                                                                                                                                                                                                                   |
| Google Sheets Updated Row                               | ✅                     | `ZapRunOutbox` (poller + `GoogleSheetsService`) → Kafka                                                                                                                                                                                                                                                                                                                                                                          |
| Google Calendar (all)                                   | ✅                     | `ZapRunOutbox` (push handler + poller) → Kafka                                                                                                                                                                                                                                                                                                                                                                                   |
| Schedule (all)                                          | ✅                     | `ZapRunOutbox` in `CronRoutes` (F6) → Kafka                                                                                                                                                                                                                                                                                                                                                                                      |
| **Gmail (New Email / Labeled / Starred / From Sender)** | ❌ **No**              | `GmailWebhookController` → `processGmailTrigger` → `ZapController.executeZapActions` executes **inline in `apps/server`** via `ActionsController.executeAction` — only `Email` (SMTP), `Solana` (**placeholder that only logs**), `Gmail*`; anything else throws `Unsupported action type`. No outbox, no `stepOutputs`, no `stepConditions`, flat `{{key}}` templating. `ZapRun` is written _after_ execution with final status |

**Consequence:** the roadmap's headline use case — _"summarizing incoming emails"_ — cannot be served by a worker-based AI step for Gmail-triggered Zaps until Gmail is routed through the outbox like every other trigger. This spec handles that as an explicit prerequisite (§4.9) instead of quietly assuming it. WhatsApp/Telegram/webhook/GitHub/Sheets/Calendar inputs work from day one.

### 1.3 UI / catalog wiring today

| Fact                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor action-config forms exist only for `Email`, `Solana`, `Gmail*`; every other action type shows _"No configuration needed"_ (pre-existing gap for WhatsApp/Telegram/Webhook actions — out of scope here)                                                                                                         | `apps/web/components/Modal.tsx` (~l.610); forms in `apps/web/components/metadata/*.tsx` behind `MetaDataFormProps.handleClick(formData)`            |
| Icons are local (`public/apps/*.svg`), resolved by ordered keyword regexes — `/email\|mail/` is last and would swallow future type names containing "mail"                                                                                                                                                            | `apps/web/lib/appIcon.ts` (`BY_KEYWORD`), `apps/web/public/apps/`                                                                                   |
| Credentials precedent is weak and must **not** be copied for AI keys: WhatsApp/Telegram tokens sit in `Action.metadata` and in plaintext DB columns (schema comments say "Encrypted", but no encryption utility exists anywhere in the repo); `fetchZapWithId` returns actions **including `metadata`** to the client | `apps/worker/src/index.ts` (reads `accessToken`/`botToken` from metadata); `GmailServer`/`WhatsAppServer` in schema; `ZapController.fetchZapWithId` |
| The repo already contains Zapier's own AI-step vocabulary to mirror: `instructions`, named inputs, `outputFields[] { name, description, type, isRequired }`, `category_single`/`category_multi` with `options` for enums, default `output` field                                                                      | `.agents/skills/workflows-ai-by-zapier/SKILL.md`                                                                                                    |

### 1.4 Provider landscape and verification gates

- Direct OpenAI: Chat Completions adapter with strict JSON Schema on supported models.
- Direct Anthropic: Messages adapter with forced `emit_output` tool and shared schema; native structured output may replace this after verification without changing the public contract.
- **Puter:** the [overview](https://docs.puter.com/) describes a user-pays service, not unlimited free AI. The [Node.js setup](https://docs.puter.com/getting-started/) documents `init(authToken)` from `@heyputer/puter.js/src/init.cjs`. Browser login is interactive; background workers must use a server-side token and cannot depend on an open browser. SDK behavior, server-side billing eligibility, token lifetime, cancellation, structured output, usage and error mapping must be verified in P1.
- **OpenAI-compatible:** supports services implementing the selected Chat Completions subset, not every third-party API. Responses-API-only endpoints, custom authentication protocols and incompatible message formats are outside the initial adapter.
- Do not copy illustrative model IDs or prices from older drafts. Verify model availability, supported parameters and prices during implementation; keep defaults and platform allowlists configurable.

## 2. Goals and non-goals

One exact catalog action, `AI Transform`, provides `summarize`, `classify`, `extract`, and `custom` modes. Results flow through existing `stepOutputs`, templates and `stepConditions`; the AI has no tools or side effects. Both worker execution and authenticated test-step previews use one shared package.

Goals: four provider choices, encrypted user-owned compatible connections, validated output, actionable failures, bounded requests, and saved-output reuse. No new Kafka topics or changes to other action semantics.

Non-goals: streaming, conversation memory, RAG, image/audio/file input, arbitrary tool execution, billing ledgers, typed-template replacement, automatic paid-provider fallback, arbitrary custom headers, Responses API support, and private-network endpoints in hosted deployments. Per-user Puter account linking is deferred until its authorization and lifecycle requirements are verified. Gmail routing remains a separate prerequisite (§4.9).

## 3. Decisions requiring approval

| ID | Decision |
| --- | --- |
| D1 | One exact `AI Transform` action, never an `AI` registry prefix. Provider selection lives in metadata. |
| D2 | Direct OpenAI/Anthropic use platform environment keys. Puter initially uses a platform server-side token for a gated proof of concept. Compatible providers use user-owned encrypted connections. Never put credentials in action metadata. |
| D3 | Action config stays JSON, but **add `AiConnection` and a Prisma migration** for BYOK. Existing actions are unchanged. |
| D4 | Platform-paid models require an operator allowlist and configured defaults. Compatible BYOK models may be manually entered, subject to request limits and any operator restrictions. No silent provider fallback. |
| D5 | Enforce input, output, timeout, response-size and daily-call limits in worker and preview paths. Budgets count individual provider attempts, including repair calls. |
| D6 | Use plain `fetch` for direct/compatible HTTP adapters. Allow the official `@heyputer/puter.js` SDK as a deliberate dependency exception; pin and test a compatible version. Use Node built-in crypto for credential encryption. Safe egress may require an explicitly reviewed transport dependency. |
| D7 | Optional `shouldRetry` preserves existing retry behavior for other actions. AI transient errors retry; fatal errors do not. Stored stage outputs are reused, but this is **not exactly-once billing**. |
| D8 | Fixed system prompts; owner instructions never template-resolved. Resolve only input and treat it as untrusted data. Validate output before downstream use. Prompt framing is risk reduction, not a guarantee against injection. |
| D9 | Deploy DB/credential and egress foundations, worker, and server validation before catalog exposure, then editor. Gmail support is not promised before PG. |
| D10 | Hosted compatible endpoints start with operator-approved domains plus transport-level SSRF protections. Arbitrary public endpoints need a later security review; local/private endpoints are self-hosted-only and separately scoped. |
| D11 | Preview and execution share connection resolution, capability rules, validation, budgets, and sanitized errors. No provider engines in the inline Gmail executor. |

## 4. Design

### 4.1 Catalog and provider identity

Seed `{ type: "AI Transform", image: "/apps/ai.svg" }` only after execution and validation are deployed. Register the exact type in `KNOWN_ACTION_TYPES`. Reject `AI`, `OpenAI`, and differently cased action names. Add icon keywords before the existing mail regex.

Provider IDs: `openai`, `anthropic`, `puter`, `openai_compatible`. Puter is an aggregator adapter, not a promise that all underlying models support identical features.

### 4.2 Action metadata contract

```jsonc
{
  "provider": "openai_compatible",
  "connectionId": "<owned saved connection ID>", // required only for compatible provider
  "model": "<provider model ID>",              // required for compatible; optional otherwise
  "mode": "extract",                          // summarize | classify | extract | custom
  "instructions": "Extract order details",    // never templated; max 4,000 chars
  "input": "{raw}",                           // required template; max 4,000 chars
  "outputFields": [
    { "name": "orderId", "type": "text", "isRequired": true }
  ],
  "temperature": 0,
  "maxOutputTokens": 500
}
```

- `classify`: 2–20 unique non-empty `categories`, each ≤60 characters; output is fixed `{ category }`.
- `extract`: 1–25 `outputFields`; `custom`: requires non-empty instructions and optionally fields. Summarize/classify do not use output fields; normalize irrelevant settings away.
- Field names: unique, ≤50 chars, `/^[a-zA-Z_][a-zA-Z0-9_]*$/`; reject dangerous prototype keys (`__proto__`, `prototype`, `constructor`). Descriptions ≤200 chars. Types: `text`, `number`, `boolean`, `category_single`, `category_multi`. Category fields require 2–50 unique non-empty options; options forbidden otherwise.
- Temperature 0–1, default 0; output tokens 16–2,000, default 500. Providers/models that cannot honor required controls must be rejected or mapped through a verified capability profile, not silently ignored.
- Compatible provider requires an owned active connection and a non-empty bounded model ID. Other providers forbid `connectionId`. `baseUrl`, credentials, capability flags and custom headers are not action metadata.
- `AiActionMetaDataSchema` strips unknown keys on create/update; store only the parsed object. Invalid metadata uses existing `411` validation style. Check connection ownership and platform model policy on save **and** at execution. Worker defensively validates stored rows.

### 4.3 Prompts and modes

Common system frame: this is a data transformation step; content inside input delimiters is untrusted data, not instructions; do not invent facts; return only the required response format. Encode/delimit input so payload text cannot trivially close the framing, while recognizing that delimiters are not a security boundary.

- `summarize`: faithful summary preserving names, dates, amounts, links and decisions.
- `classify`: choose exactly one supplied category.
- `extract`: use facts present in input; missing optional values become null; bare numbers only.
- `custom`: owner instructions define the task; structured output if fields exist, plain text otherwise.

### 4.4 Uniform output contract

```jsonc
{
  "output": "serialized result or plain text",
  "fields": { "orderId": "84120" },
  "provider": "openai_compatible",
  "model": "<resolved model ID>",
  "mode": "extract",
  "usage": { "inputTokens": 1234, "outputTokens": 87 },
  "truncated": false,
  "latencyMs": 1420
}
```

Summary fields are `{ summary }`; classification fields are `{ category }`; plain custom fields are empty. Structured `output` is `JSON.stringify(fields)`. Usage is provider-reported only; omit unavailable values. Aggregate reported usage across initial and repair responses without fabricating missing counts. Do not persist keys, auth tokens or base URLs in output.

References: `{previousOutput.output}`, `{previousOutput.fields.category}`, `{stepOutputs.2.fields.orderId}`. Conditions use `previousOutput.fields.category`. Whole-object templates still stringify as `[object Object]`; use the serialized `output` string. Existing templating may degrade typed leaves to strings; fixing that globally is out of scope.

### 4.5 Shared execution and adapters (`@repo/ai`)

```text
src/index.ts         runAiStep(config, resolvedInput, executionContext)
src/providers.ts     direct OpenAI and Anthropic adapters
src/compatible.ts    compatible Chat Completions adapter
src/puter.ts         server-side Puter SDK adapter
src/schema.ts        shared JSON Schema builder and output validator
src/prompts.ts       versioned system prompts
src/errors.ts        sanitized AiStepError with retryable/status/provider
src/capabilities.ts  reviewed provider/model capability profiles
src/transport.ts     bounded HTTP transport and safe-egress integration
```

Execution context supplies owner ID, optional run ID/stage, resolved credentials, policy and a budget hook. Credentials are internal-only and must never appear in serializable outputs or errors. Server and worker resolve credentials through the same server-only connection service; `@repo/ai` must not be imported into browser code.

Flow:
1. Validate config, provider enablement, owned connection, model policy and capability profile; missing credentials fail before any request.
2. Resolve only `input` via existing `replaceKeys` with trigger data, `previousOutput` and `stepOutputs`. Unknown placeholders stay literal. Empty/whitespace input is fatal. Truncate to cap and flag.
3. Reserve budget for each outgoing attempt, then send with bounded timeout and response size. No prompt/body/credential logging.
4. Parse text or structured response; validate fields, finite numeric values, booleans, enums and array subsets; drop extra keys and deduplicate multi-category arrays. Coerce only explicitly supported forms such as `"42"` and `"true"`. Missing required or non-nullable values fail validation.
5. Invalid structured output gets **one repair call per step execution**, including across transport retries. Repair never replenishes itself on retry. Exhaustion, refusal or output truncation without a valid result fails clearly; do not record fake success.
6. Return the envelope and persist through existing worker output handling.

**Direct adapters:** OpenAI Chat Completions uses strict JSON Schema for supported structured modes. Anthropic uses a forced `emit_output` tool; plain-text output is invalid when a tool result is required. Optional schema fields must be represented using nullable fields with the provider's strict-schema requirements.

**Puter:** initialize SDK server-side with `PUTER_AUTH_TOKEN`. Verify the documented import against the pinned package. Never perform interactive login in a Kafka worker. Map text, usage and errors into shared contracts; unavailable usage stays omitted. Enable only tested model profiles. Prove cancellation or bound in-flight work in an isolatable execution context before production; a `Promise.race` alone does not cancel a billable request. No automatic fallback to another provider. Confirm account/billing suitability, token renewal/revocation and retention policies before production.

**OpenAI-compatible:** normalize a versioned base URL such as `https://provider.example/v1` and append `/chat/completions` exactly once, preserving the approved path. Bearer authentication only in initial scope. Structured capability is an operator-reviewed profile: `json_schema`, `json_object`, or `prompt_json`. Always apply local validation; JSON mode alone does not enforce schema. Parameter compatibility (temperature, token parameter, system-message support) must be tested per profile. Do not discover capabilities by uncontrolled retries or silently downgrade after a billed request. Model-list discovery is optional; manually entered models are supported. No Responses API, streaming, arbitrary tools or custom headers in this version.

**Retries and replay:** extend `withRetry` with optional `shouldRetry`. Retry 429/5xx/timeouts/network failures within the existing bounded attempt policy; 400/401/403/404, policy/configuration/budget failures and exhausted validation repair are fatal. Unknown SDK errors default fatal until classified. Pass `{ userId, zapRunId, stage }` into the AI branch. Check presence of persisted `stepOutputs[stage]` before resolving credentials or making requests; reuse it on replay. A crash between provider success and persistence, or a timeout after provider acceptance, can still cause repeat billing. Concurrent delivery also requires coordination for stronger guarantees; do not claim exactly-once execution.

### 4.6 Environment and configuration

| Setting | Default / purpose |
| --- | --- |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Optional platform secrets; missing selected key is fatal |
| `PUTER_AUTH_TOKEN` | Optional server-only platform token; never sent to browser |
| `AI_PUTER_ENABLED` | false until verification gates pass |
| `AI_DEFAULT_PROVIDER` | `openai`; UI can suggest a configured provider, never silently change execution provider |
| `AI_DEFAULT_MODEL_OPENAI`, `AI_DEFAULT_MODEL_ANTHROPIC`, `AI_DEFAULT_MODEL_PUTER` | Verified model IDs selected during implementation |
| `AI_MODEL_ALLOWLIST_OPENAI`, `AI_MODEL_ALLOWLIST_ANTHROPIC`, `AI_MODEL_ALLOWLIST_PUTER` | Provider-specific platform-paid allowlists |
| `AI_MAX_INPUT_CHARS` | 20,000 |
| `AI_MAX_OUTPUT_TOKENS` | 2,000 hard ceiling; per-step default 500 |
| `AI_TIMEOUT_MS` | 60,000 per request, plus bounded total execution time |
| `AI_MAX_RESPONSE_BYTES` | 1,048,576; enforce while reading, not after unbounded buffering |
| `AI_DAILY_CALL_CAP_PER_USER` | 200; 0 disables |
| `AI_DAILY_CALL_CAP_GLOBAL` | 0 (off) |
| `AI_BUDGET_FAIL_OPEN` | false for new paid AI calls; unavailable Redis fails AI only |
| `AI_CONNECTION_ENCRYPTION_KEYS` | Server/worker secret keyring, never exposed; deployment-secret format defined in PC |
| `AI_CONNECTION_ACTIVE_KEY_ID` | Active encryption key version |
| `AI_COMPATIBLE_ALLOWED_HOSTS` | Empty denies compatible connections; explicit reviewed hostnames only |

Validate matching policy settings in server and worker; malformed configured caps/keyrings fail startup. Document optional integration secrets in root and both app `.env.example` files. Do not invent real secret values in examples. Puter and compatible support are disabled until their prerequisites are configured.

### 4.7 Daily budgets

Use Redis atomic reservation (Lua or equivalent transaction) to check/increment owner and optional global UTC-day counters together, with 48-hour TTL. Apply the same mechanism to tests, initial requests, repairs and retries. Reserve **before** sending to avoid concurrent overshoot; attempts with ambiguous delivery or invalid billed responses remain counted. Only release a reservation when no request was dispatched. Provider-side spend and token quotas are not equivalent to this attempt counter.

Default to fail closed for AI on Redis failure; unrelated actions continue. Operator-selected fail-open logs a sanitized warning and makes budgets best-effort, never hard ceilings. This deliberately replaces the prior draft's unconditional fail-open behavior. Compatible BYOK still receives abuse/rate limits even though the user pays the provider.

### 4.8 Server APIs and authorization

All endpoints below require `authMiddleware`; mutating/test operations use the existing API limiter and appropriate request-size limits.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/actions/ai/models` | Configured/enabled providers, platform allowlisted models/defaults and tested capabilities; never secrets. Compatible provider indicates connection required, not platform key presence. |
| `POST /api/actions/ai/test` | Parsed action config with literal sample `input`; shared owner-scoped resolution/executor/budgets; return §4.4, no `ZapRun`. Sample input may be up to input cap rather than template cap. |
| `GET /api/ai/connections` | List caller-owned redacted connections only |
| `POST /api/ai/connections` | Validate approved URL/profile, encrypt submitted key, return redacted connection |
| `PATCH /api/ai/connections/:id` | Owner-scoped updates; omitted key means unchanged, supplied key replaces; no reveal endpoint |
| `POST /api/ai/connections/:id/test` | Owner-scoped bounded probe, safe egress and budget accounting; no raw provider errors |
| `DELETE /api/ai/connections/:id` | Soft-revoke; prevent future execution, return affected-Zap count without exposing other users |

Connection IDs are untrusted references: enforce owner and active-state checks on all operations, Zap create/update, preview and worker execution. Do not reveal whether another user's connection exists. Sanitize upstream errors rather than returning raw bodies. Other action schemas retain their existing behavior. Never add AI execution to `ActionsController.executeAction` on the inline Gmail path.

### 4.9 Prerequisite (separate PR): route Gmail triggers through the outbox

For the "summarize incoming emails" use case with Gmail triggers. Sketch (full treatment in its own change):

- In the Gmail trigger fan-out (`GmailTriggersController.processGmailTrigger` → `ZapController.processGmailTrigger`), replace `executeZapActions(zap, emailData)` with: create `ZapRun { zapId, metadata: emailData, status: "pending" }` + `ZapRunOutbox` (the F6 pattern from `CronRoutes`). The processor already drains outbox → Kafka → worker.
- `emailData` keys come from `GmailService` (e.g. `subject`, `snippet`, sender fields — implementer must pin the exact shape and keep it stable, since AI `input` templates will reference it, e.g. `"{subject}\n\n{snippet}"`, plus body text if present).
- **Blast radius to handle in that PR:** Gmail-triggered Zaps gain all worker actions (WhatsApp/Telegram/Webhook/AI) and chaining/conditions; they lose the server-only `Email`-via-SMTP/`Gmail*` inline execution. Before flipping, audit existing `Action` rows on Gmail-triggered Zaps for types the worker rejects (they would start failing loudly — which is honest, but must be communicated). The inline `Solana` placeholder in `ActionsController` currently _pretends_ to send SOL for Gmail Zaps — routing to the worker makes it real; call this out to users explicitly.
- Non-Gmail triggers are unaffected; §5 Examples 1–2 are written against webhook/WhatsApp so they ship before this prerequisite.

### 4.10 Web editor

Create `AiMetaData.tsx`, its barrel export and the exact-type Modal branch. Provider selector includes all four IDs. Platform models come from the models API; disable unavailable providers with a reason. Compatible selection shows a saved-connection picker, manage/connect dialog, manual model field, and tested structured-output capability hint.

Connection dialog: name, HTTPS versioned base URL, write-only API key, and an operator-approved capability profile (not arbitrary capability flags). Never prefill or persist credentials in browser local storage, action form state after save, workflow exports, or analytics. API submissions contain secrets only on explicit create/replace.

Mode-specific categories/output fields, instructions (labelled never templated), input-template help, advanced settings, and literal-sample test panel are required. Render parsed fields, text, reported usage and latency; sanitize error display. Client limits are convenience only; server is authoritative.

Disclosure: “Text mapped into Input is sent to the selected AI service and, for aggregators such as Puter, may be processed by an underlying model provider. Do not map secrets or regulated data without approval. Usage may be billed to the configured account.” Warn against wiring AI output directly into money-moving actions.

### 4.11 Encrypted connection data model

Add `AiConnection` with `id`, `userId` relation, `name`, provider fixed to `openai_compatible` for initial user-owned connections, canonical `baseUrl`, approved `capabilityProfileId`, encrypted credential ciphertext, nonce, authentication tag, `keyId`, `createdAt`, `updatedAt`, and `revokedAt`. Index by owner; never return encrypted fields. Puter uses env initially, not this connection type.

Use Node `crypto` AES-256-GCM, fresh cryptographically random nonce per encryption and authenticated additional data binding connection ID, owner and provider. Keys live outside the database and Git; fail closed on missing keys or authentication failure. Maintain a versioned keyring and rotation/re-encryption procedure before enabling connections in production. Revoke at execution start; an already dispatched request cannot be recalled by deleting a connection. Referenced revoked connections make runs fail clearly, never switch credentials silently.

### 4.12 Compatible-endpoint egress security

A user-provided base URL is an SSRF surface even with BYOK. Apply defenses in create/update/probe **and every runtime request**:

- HTTPS with certificate validation; initial port 443 only. Reject embedded credentials, fragments, queries, IP literals and malformed/ambiguous URLs. Canonicalize hostname/path before policy checks.
- Exact operator-approved hostname matching, not unsafe suffix matching. Preserve approved API path; never accept a complete arbitrary endpoint per action.
- Resolve and validate all A/AAAA addresses. Block loopback, private, link-local, reserved, multicast, unspecified, IPv4-mapped IPv6 bypasses and metadata endpoints.
- Bind the validated destination to the actual connection (with correct TLS hostname verification) or use a policy-enforcing egress proxy. DNS preflight followed by ordinary unpinned fetch is insufficient against rebinding.
- Disable redirects; never forward Authorization to a redirect destination. Bound request time, response bytes and concurrent calls. Avoid credential-bearing URLs and redact errors/logs.
- Add network-level egress restrictions where available. If safe transport cannot be proven, compatible endpoints stay disabled. Browser CORS is not an SSRF defense.

Arbitrary public domains are a later security-reviewed expansion. Private Ollama/local endpoints require a separate self-hosted-only design, not an exception in hosted production.

## 5. Worked examples

### 5.1 Summarize incoming messages → notify (ships day one via WhatsApp; Gmail after §4.9)

Trigger `WhatsApp Message Received` → Action 1 `AI Transform` → Action 2 `Telegram Send Message`.

```jsonc
// Action 1 metadata
{ "provider": "anthropic", "mode": "summarize",
  "instructions": "Summarize in at most 2 short sentences. Keep names, dates and amounts exact.",
  "input": "{text}" }                       // WhatsApp payload root key (whatsappHandler.ts)
// Action 2 metadata
{ "chatId": "…", "message": "📩 New WhatsApp from {fromName}:\n{previousOutput.output}" }
```

For Gmail (after §4.9): `"input": "{subject}\n\n{snippet}"` with trigger `Gmail New Email` — same Zap otherwise.

### 5.2 Ticket sentiment → conditional alert

Trigger `Webhook` (support system POSTs `{ "ticketId": "T-9182", "message": "…" }`) → Action 1 `AI Transform` (classify) → Action 2 `WhatsApp Send Message` with a step condition.

```jsonc
// Action 1 metadata
{
  "provider": "openai",
  "mode": "classify",
  "instructions": "Classify the customer's sentiment about our service. Sarcastic praise counts as negative.",
  "input": "{message}",
  "categories": ["positive", "neutral", "negative"],
}
// Action 2: metadata { "to": "…", "message": "⚠️ Negative ticket {ticketId}: {message}" }
//          stepConditions [{ "field": "previousOutput.fields.category", "operator": "equals", "value": "negative" }]
```

Non-negative tickets skip Action 2 via the existing `stepConditions` machinery (`evaluateFilters`) — no new branching code.

### 5.3 Raw webhook text → structured JSON → downstream API

Trigger `Webhook` (`{ "raw": "Hi, I'm Priya (Priya@example.com). My order 84120 of ₹1,499 never arrived." }`) → Action 1 `AI Transform` (extract) → Action 2 `Webhook` POST to the CRM.

```jsonc
// Action 1 metadata
{
  "provider": "openai",
  "mode": "extract",
  "input": "{raw}",
  "outputFields": [
    { "name": "customerName", "type": "text", "isRequired": true },
    { "name": "email", "type": "text", "isRequired": true },
    { "name": "orderId", "type": "text", "isRequired": true },
    {
      "name": "amount",
      "type": "number",
      "description": "Order amount as a bare number",
      "isRequired": false,
    },
    {
      "name": "issueType",
      "type": "category_single",
      "options": ["delivery", "payment", "quality", "other"],
      "isRequired": true,
    },
  ],
}
// Stored output.fields → { customerName:"Priya", email:"Priya@example.com", orderId:"84120", amount:1499, issueType:"delivery" }
// Action 2 (Webhook) body { "name": "{previousOutput.fields.customerName}", "email": "{previousOutput.fields.email}",
//   "order": "{previousOutput.fields.orderId}", "rawAi": "{previousOutput.output}" }   // note §4.4 stringification caveat
```

---

### 5.4 Puter summary (gated)

Use the same message-to-notification workflow as §5.1 with this AI metadata:

```jsonc
{
  "provider": "puter",
  "mode": "summarize",
  "input": "{text}",
  "instructions": "Summarize in two short sentences."
}
```

Model comes from the configured Puter default/allowlist. No token or browser session is stored in the action. Missing token, disabled integration or an unverified model fails before dispatch.

### 5.5 Compatible BYOK extraction

First create an owned connection through the authenticated connection API:

```jsonc
{
  "name": "My approved AI service",
  "baseUrl": "https://provider.example/v1",
  "apiKey": "<submitted once over HTTPS; encrypted server-side>",
  "capabilityProfileId": "<operator-approved profile>"
}
```

The hostname is illustrative: it must be explicitly approved and pass safe-egress checks before use. Select the saved connection in the editor, then configure:

```jsonc
{
  "provider": "openai_compatible",
  "connectionId": "<ID returned by connection creation>",
  "model": "<model supported by that endpoint>",
  "mode": "extract",
  "input": "{raw}",
  "outputFields": [
    { "name": "orderId", "type": "text", "isRequired": true }
  ]
}
```

Downstream references remain `{previousOutput.fields.orderId}` regardless of provider. Revoking the connection fails future runs clearly; it never switches to a platform-paid key.

---

## 6. Security, privacy and abuse

| Risk | Required mitigation |
| --- | --- |
| Credential disclosure | Env for platform secrets; authenticated encryption for BYOK; write-only replacement APIs; no secrets in metadata, outputs, logs, errors or client bundles |
| Cross-tenant access | Owner checks on CRUD, save, test and worker lookup; redact foreign resource existence |
| SSRF / credential forwarding | §4.12 safe transport, approved hosts, no redirects and no arbitrary headers |
| Prompt injection | Fixed framing, schema validation and no model tools; well-formed output may still be wrong |
| AI output into Solana | Explicit warning; deterministic bounds/validation and human approval where appropriate. Schema checks do not establish financial correctness. |
| Cost abuse | Platform model allowlists, per-attempt atomic budgets, API rate limiting and bounded concurrency; no automatic paid fallback |
| Third-party disclosure | Owner sign-off on direct, aggregator and custom endpoint retention policies; identify selected service in editor |
| Retry/crash duplicates | Bounded retries and persisted-output reuse; disclose crash-window and ambiguous-timeout billing risk |
| SDK and endpoint variability | Pin Puter SDK, reviewed capability profiles, contract tests, no unsupported-feature parity claims |

Provider outputs are persisted in run metadata; they can contain personal data from input. Existing retention/access policies apply and need privacy review. Platform credentials must never be transmitted to a user-selected endpoint.

## 7. Cost model and accounting

For each billed attempt, estimated cost is `(inputTokens × inputPrice + outputTokens × outputPrice) / 1e6`, using verified prices for that provider/model. Repairs, retries and timeout ambiguity can increase total spend. Character limits are not strict token or dollar limits; a 20,000-character input does not guarantee 5,000 tokens across languages/tokenizers. Set provider-side spending controls where supported.

Direct platform accounts pay for direct calls. Puter advertises user-pays, but using a platform token requires explicit confirmation of account billing and multi-user server-side eligibility; do not advertise it as free/unlimited. Compatible BYOK calls bill the configured third-party account under its terms. Redis measures attempts, not invoices. Usage missing from a response is omitted; exact billing reconciliation requires a later usage ledger.

## 8. File/change map

| Area | Planned changes | Phase |
| --- | --- | --- |
| `packages/db/prisma/schema.prisma`, new migration | `AiConnection`, owner relation/index, encrypted credential fields and revocation | PC |
| New server-only shared credential service (e.g. `packages/ai-connections`) | Owner-scoped DB lookup, Node crypto, redacted DTOs, key rotation, approved URL validation; reusable by server/worker | PC |
| `packages/ai` package/build config and `src/*` | §4.5 adapters, schemas, prompts, capabilities, bounded transport; pinned Puter SDK | P1 |
| Workspace manifests and existing lockfiles | Shared package references and reviewed dependencies; use repository package-manager conventions | PC/P1 |
| `apps/worker/src/utils/retry.ts` | Optional retry predicate, existing defaults unchanged | P1 |
| `apps/worker/src/utils/actionTypes.ts`, `src/index.ts` | Exact registry, execution context, shared credential lookup, replay guard, AI dispatch | P1 |
| `apps/worker/tests/*`, new package tests | Adapter, retry, validation, replay, transport and budget tests | PC/P1 |
| `packages/types/src/index.ts` | Action/connection/test schemas and types, provider discrimination | P3 |
| Server Zap controller and AI routes/controllers | Parsed create/update metadata, owned connection checks, model/test/connection APIs | PC/P3 |
| `apps/server/src/env.ts`, worker config, root/app `.env.example` | Optional integration secrets, strict policy validation, budget/egress/keyring docs | PC–P3 |
| `apps/server/src/seed.ts`, seed tests | Sixth executable action, idempotent seed and registry invariant | P2 |
| `apps/web/public/apps/ai.svg`, `lib/appIcon.ts` | Icon and ordered keyword mapping | P2 |
| `apps/web/components/metadata/AiMetaData.tsx`, barrel and `Modal.tsx`; new connection UI | Provider/configuration form, saved connections, secret replacement, test panel | P4 |
| `README.md`, new gated E2E tests | Setup, billing/security constraints, four-provider verification | P5 |
| Gmail controllers (separate PR) | Gmail outbox routing and blast-radius audit | PG |

No AI changes to hooks/processor, Kafka topics, generic `replaceKeys`, `evaluateFilters` or other action branches. Unlike the previous revision, a DB migration and shared credential service are explicitly in scope.

## 9. Test plan

Use mocked transport/SDK in CI; real-provider tests are opt-in, never ordinary CI.

**Shared package and worker**
1. Missing env credential, invalid config/model, foreign/revoked connection: fatal before any provider request.
2. All four modes and providers normalize to §4.4; missing usage omitted; structured fields and summary/classification aliases correct.
3. Invalid category/required field/type gets one repair maximum; still invalid fails. Numeric/boolean coercion, optional nulls, enum subsets, unknown-key dropping and dangerous field names covered.
4. Input-only templating, previous-step context, literal unknown placeholders, untemplated instructions, empty-input rejection and truncation covered.
5. 429 then success retries; 401 exactly one attempt; timeout/network behavior classified. Existing actions retain prior retry semantics. Repair budget does not reset on transient retry.
6. Persisted stage output reuses without credential lookup/provider call; document duplicate risk for an unpersisted accepted request instead of asserting exactly-once billing.
7. Anthropic forced-tool parsing; direct OpenAI strict schema; compatible `json_schema`, `json_object`, `prompt_json` and incompatible-parameter rejection.
8. Puter SDK init, text/structured result mapping, optional usage, fatal unknown errors, verified cancellation and gated availability. No interactive worker login.
9. Atomic budgets under concurrency, UTC expiry, per-user/global limits, repairs/retries/previews counted, Redis fail-closed and explicit fail-open modes.
10. Bounded response reading, redirects, safe transport, concurrency and credential redaction; system framing included without treating injection resistance as guaranteed.

**Connections/server/security**
- Encryption round-trip, randomized nonce, tamper failure, AAD owner binding, unknown-key failure and rotation.
- Authentication and owner isolation for every CRUD/probe/save/test/runtime operation; revoked connections fail without fallback; no key/ciphertext leakage in any DTO, run output or sanitized error.
- SSRF matrix: localhost/private/metadata IPv4 and IPv6, mapped IPv6, alternate encodings, URL credentials, query/fragment, redirect to private host, mixed DNS results and rebinding. Prove the validated destination is the one connected to.
- Model discovery reflects key presence and enablement without leaking values. Metadata schema matrix and stored parsed objects; invalid create/update returns `411`. Compatible model IDs do not use platform defaults.
- Seed has six actions, all worker-executable; unknown exact types rejected; seed idempotence.

**Gated E2E:** `RUN_E2E=1`, test DB and explicitly configured test credentials. Webhook → AI classify/extract → mock Webhook receiver; assert conditions and saved outputs. Repeat supported cases for direct providers, gated Puter, and an approved compatible test endpoint; cleanup connections/Zaps/runs. Never contact arbitrary URLs in CI.

**Manual:** connection create/replace/revoke, four provider forms, all modes, unavailable-provider hints, privacy/billing disclosure, sample testing and legible run outputs. Gmail scenario only after PG.

## 10. Phases and acceptance criteria

| Phase | Deliverable | Acceptance |
| --- | --- | --- |
| P0 | Revised spec | Owner approves §3 and production policies in §11 before implementation |
| PC | Migration, encrypted connection service/APIs, safe-egress transport, policy config | Migration tested; owner isolation, crypto, rotation and SSRF tests pass; compatible provider remains gated |
| P1 | Shared AI package, four adapters, worker registry/context/retry/replay, atomic budgets | Mocked tests/build/typecheck pass; Puter gates verified or adapter stays disabled; no catalog exposure |
| P3 | Action schemas, create/update validation, model/test APIs | Parsed metadata stored; invalid config rejected; preview shares credentials/policies/budgets; no secrets leaked |
| P2 | Seed and icon **after PC/P1/P3 deployments** | Catalog exposes only an executable, validated action; seed registry invariant passes |
| P4 | Editor form, connection picker/management, sample test UI | Worked examples buildable; secure write-only credential flow and disclosure visible |
| P5 | Gated E2E and docs | Each enabled provider passes staging verification; billing, key rotation, egress and rollback documented |
| PG | Separate Gmail → outbox PR | Gmail chaining/conditions work and existing-Zap blast-radius audit completed |

Phase labels preserve previous references; P3 intentionally precedes P2 exposure. Puter/compatible activation is conditional on their own gates, not merely adapter code landing.

**Rollback:** disable AI/provider gates and stop new requests, deactivate affected Zaps before removing catalog availability, then remove execution support only after in-flight work is handled. Removing platform keys does not disable BYOK connections. Revoke connections separately as needed; preserve encryption keys while retained records require decryption. Do not automatically roll back/drop the connection table or erase ciphertext on application rollback. Prefer additive migration and forward fixes.

## 11. Owner decisions and open questions

| ID | Question | Recommendation / gate |
| --- | --- | --- |
| Q1 | Direct platform funding and compatible BYOK approved? | Support both, isolated credentials and no automatic fallback; approve before production |
| Q2 | Default provider and initial models? | OpenAI default; select verified cheap platform models at implementation, not illustrative draft IDs |
| Q3 | Privacy/retention and aggregator/custom endpoint disclosure approved? | Required before enabling each service; request zero retention where offered, never assume it |
| Q4 | Gmail same release or follow-up? | Separate parallel PG; no Gmail summarization claim until complete |
| Q5 | Daily budgets and outage policy? | 200/user/day, global configurable; fail closed for AI by default. Explicit approval required for fail-open |
| Q6 | Puter account identity, billing, token lifecycle and SDK production suitability? | Platform-token development POC first; keep production disabled until verified. Per-user linking is a later design |
| Q7 | Which compatible domains/profiles are approved? | Start with explicit operator-reviewed hosts; empty allowlist disables support; arbitrary public URLs deferred |
| Q8 | Encryption secret custody, recovery and rotation owner? | Deployment-managed keyring plus tested rotation/runbook before production BYOK |
| Q9 | Safe outbound transport/proxy available? | Required for compatible activation; hostname checks and DNS preflight alone are insufficient |

## 12. Deferred work

- Per-user Puter account connection/consent, token renewal and revocation flows after provider verification.
- Arbitrary public compatible domains, private/local self-hosted endpoints, non-Bearer authentication, custom headers and Responses API adapters.
- Direct OpenAI/Anthropic BYOK UI (connection foundation can support it later).
- Exact billing ledger, user credits and stronger crash-window/concurrent-delivery coordination.
- Typed template substitution, `Retry-After`, prompt caching, run-history enhancements and dedicated financial-output guards.
- Unrelated existing action configuration gaps.

## 13. Completion checklist

Implementation progress (2026-10-19): PC foundation added: additive migration, shared encrypted-connection service, owner-scoped Bearer-only CRUD, bounded pinned-IP transport, key-rotation CLI and mocked tests. See `reports/ai-connection-operations.md`. PC is not production-accepted until staging DB and live egress verification pass. Probe/preview, affected-Zap reporting, budgets and editor CSRF integration remain for later phases. Provider execution/catalog exposure remain disabled.


- [x] Original spec authored; revised for Puter and OpenAI-compatible connections
P1 progress: `@repo/ai` adapters/executor, per-attempt atomic Redis reservations, retry predicate, saved-output replay and worker integration are implemented with mocked tests. Puter SDK 2.6.4 is isolated and disabled by default; live verification is outstanding. Shared owner-scoped Prisma adapter now lives in `@repo/ai-connections`. Platform model IDs/allowlists require explicit operator configuration rather than unverified defaults. Failed repair dispatches are fatal and never retried. P1 acceptance is not complete until gated provider tests pass. P3 precedes catalog exposure.

- [ ] Owner approves decisions and applicable production gates
- [ ] PC — Migration, encrypted connections, APIs, rotation and safe egress
- [ ] P1 — Shared adapters, worker, retry/replay, budgets and tests
- [x] P3 — Metadata validation, models/test endpoints, CSRF and budgeted connection probes; mocked tests pass
- [x] P2 — Seed/icon after worker and server support; six-action registry invariant tested
- [ ] P4 — Editor and secure connection management
- [ ] P5 — Gated E2E and documentation
- [ ] Puter verification complete before production activation
- [ ] Compatible SSRF/transport verification complete before activation
- [ ] PG — Separate Gmail routing prerequisite implemented
