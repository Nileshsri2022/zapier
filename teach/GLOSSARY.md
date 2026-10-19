# AI Transform Glossary

Concise language for ZapMate's AI step. Every lesson uses these terms exactly.

## Terms

**AI Transform**:
The single executable action type (`AvailableActions.type = "AI Transform"`) that turns input text into summarized, classified, or structured output inside a Zap. _Avoid_: AI action, OpenAI action, AI step (as a type name).

**Action metadata**:
The JSON stored in `Action.metadata` that configures one Zap step. For AI Transform it is an `AiConfig` validated by `validateAiConfig` and `AiActionMetaDataSchema`. _Avoid_: action config, payload.

**Mode**:
One of four behaviors — `summarize`, `classify`, `extract`, `custom` — that determines the system instruction and whether structured JSON Schema validation applies.

**Instructions**:
Owner-authored guidance for the model (`instructions` field). Never template-resolved; treated as trusted configuration, not user data. _Avoid_: prompt (when referring to this field).

**Input template**:
The `input` string (max 4,000 chars) containing `{placeholders}` resolved by `replaceKeys` against trigger data and prior outputs. The only templated field in the AI config.

**Framed input**:
The resolved input wrapped as `<input>\n…\n</input>` with HTML-escaped content, sent as the user message. Untrusted data — the model is instructed never to follow it as directions.

**Output envelope**:
The persisted result of a successful AI call: `{ output, fields, provider, model, mode, usage, truncated, latencyMs }` as returned by `runAiStep` and stored in `stepOutputs[stage]`.

**Fields**:
The validated, typed object inside the envelope (`output: JSON.stringify(fields)` when structured). Contains `category` for classify, `summary` for summarize, or the named `outputFields` for extract/custom-with-fields.

**Provider**:
One of `openai`, `anthropic`, `puter`, `openai_compatible`. Selection lives in action metadata (D1); the catalog type stays `AI Transform`.

**BYOK connection**:
An owner-scoped `AiConnection` record (encrypted AES-256-GCM, keyId-bound) for `openai_compatible` only. Never exposed to the browser; resolved server-side at preview and execution time.

**Capability profile**:
The operator-reviewed structured-output capability declared for a BYOK endpoint — `chat_json_schema`, `chat_json_object`, or `chat_prompt_json` — that controls `response_format` sent to the endpoint.

**Budget reservation**:
The Redis Lua atomic check-and-increment (`RESERVE_AI_CALL_LUA`) against per-user and optional global daily caps. One reservation per provider attempt (including the single repair attempt).

**Repair**:
The one additional provider call allowed when structured output fails local validation. Tracked by `ExecutionState.repairUsed`; never self-replenishes on retry.

**Replay**:
Skipping credential resolution and the provider call entirely when `stepOutputs[stage]` already exists (Kafka at-least-once re-delivery). Not exactly-once billing.

**Step condition**:
A `filterConditions` predicate evaluated before a stage runs (e.g. `previousOutput.fields.category == "negative"`). Uses `evaluateFilters`; failing it skips the action but still completes the run via `advanceSkippedStage`.

## Modes (quick reference)

**Summarize**: Faithful short restatement preserving names/dates/amounts/links. No structured fields (envelope alias: `{ summary }`).

**Classify**: Choose exactly one from 2–20 unique categories. Fixed schema `{ category: enum }`.

**Extract**: Fill 1–25 named typed fields from facts present in input; missing optional → `null`; bare numbers only.

**Custom**: Owner instructions define the task; structured if `outputFields` present, else plain text (summarize-shaped).
