# Specification: AI Transform Action (`AvailableActions.type = "AI Transform"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: AI Transform Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Users need to summarize long emails or webhooks, classify incoming messages into routing categories, extract structured JSON fields from unstructured text, or run custom reasoning prompts inside a Zap with strict cost, schema, and SSRF security guarantees.

---

## Solution

Provide a native `AI Transform` action supporting four modes (`summarize`, `classify`, `extract`, `custom`) across four providers (`openai`, `anthropic`, `compatible` via AES-256-GCM encrypted user `AiConnection` records with DNS/IP SSRF pinning, and `puter` via isolated worker threads), atomic Redis daily budget enforcement, one-shot JSON repair, and step-output chaining (`{previousOutput.result}`, `{previousOutput.category}`, `{previousOutput.fields.<key>}`).

---

## User Stories

1. As a Zap creator, I want to select `AI Transform` in the action modal and choose between `summarize`, `classify`, `extract`, and `custom` modes in `AiMetaData`.
2. As a Zap creator, I want to choose a provider (`openai`, `anthropic`, `compatible`, or `puter`) and model, or create an encrypted OpenAI-compatible connection whose API key is write-only and never returned to the browser.
3. As a Zap creator, I want to test my AI Transform configuration directly in the modal against literal sample input before saving the step.
4. As a Zap creator, I want to add conditional step filters (`StepConditionsEditor`) on downstream actions that check `{previousOutput.category}` or `{previousOutput.fields.*}`, so that AI classification routes execution dynamically.
5. As a platform operator, I want `executeAiAction` in `apps/worker` to reuse stored `stepOutputs[stage]` on Kafka replay so a redelivered stage never double-spends AI budget.
6. As a security engineer, I want user-supplied `compatible` base URLs validated against `AI_COMPATIBLE_ALLOWED_HOSTS` and resolved via DNS pinning that blocks private, loopback, link-local, and cloud-metadata IP ranges.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `AI Transform Action`, `ZapRun`, and `Outbox` per `GLOSSARY.md` and `ADR-0004`.
- **Four Structured Modes (`@repo/ai`)**: `summarize` outputs `{ result, summary }`, `classify` outputs `{ result, category, confidence?, reason? }` validated against allowed categories with at most one repair pass, `extract` outputs `{ result, fields }` coerced against declared field types (`string`, `number`, `boolean`, `category`), and `custom` supports plain text or key/value JSON schema.
- **Prompt-Injection & Input Cap Protection**: Untrusted interpolated input is wrapped in escaped `<zapmate_untrusted_input>` delimiters and truncated to `maxInputChars`; owner instructions are never template-interpolated.
- **Encrypted Connections & SSRF Guard (`@repo/ai-connections`)**: AES-256-GCM with AAD binding `(id, userId, provider)` and `createCompatibleTransport` pinning the verified public IP while preserving TLS SNI and certificate verification.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Core AI Execution & Budget Seam (`@repo/ai` — `runAiStep`, `createDailyBudget`, `validateAiConfig`)**: Tests mode schemas, one-shot repair, input truncation/escaping, provider adapters, Puter worker thread isolation, and Redis budget reservation.
2. **Encrypted Connection & SSRF Transport Seam (`@repo/ai-connections`)**: Tests AES-256-GCM vault encryption/rotation, host allowlisting, private IP rejection, DNS rebinding protection, and owner-scoped CRUD.
3. **Worker & Server Integration Seam (`executeAiAction`, `AiActionsRoutes`, `AiConnectionsRoutes`)**: Tests stage replay idempotency, retry classification, and HTTP API routes.
4. **Web Form & Step Conditions Seam (`AiMetaData`, `StepConditionsEditor`)**: Tests provider discovery, mode validation, write-only connection keys, sample test panel, and condition builder.

### Prior Art in Codebase
- `packages/ai/tests/execution.test.cjs` & `providers.test.cjs` & `budget.test.cjs` & `puter.test.cjs`
- `packages/ai-connections/tests/foundation.test.cjs` & `transport.test.cjs`
- `apps/worker/tests/aiStep.test.ts`
- `apps/web/tests/ai-form.test.cjs`

---

## Out of Scope

- Multi-turn conversational memory across separate ZapRuns.
- Automatic fallback from a user-selected provider to a different paid provider on failure.

---

## Further Notes

- See `reports/ai-reasoning-step-spec.md` and `teach/chapter-01-how-ai-transform-works/` for the deep architectural reference.
