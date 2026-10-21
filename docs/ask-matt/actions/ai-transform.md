# A1 — AI Transform (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A1 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Transform data from earlier steps with an LLM.

> **As a** Zap builder, **I want** to classify, extract, summarize, generate, translate, or
> run a custom prompt over mapped inputs, **so that** unstructured data becomes structured
> fields (or vice versa) without writing code.

## 2. Operations — ✅ grilled (Q-AI-01)

| # | Operation | v1 verdict |
|---|---|---|
| O1 | Classify | ✅ IN SCOPE — text → label from user list (+ optional confidence) |
| O2 | Extract | ✅ IN SCOPE — text → JSON via user field-list/schema |
| O3 | Generate / Rewrite | ✅ IN SCOPE — prompt → new text |
| O4 | Summarize | ✅ IN SCOPE — long → short (bullet or prose) |
| O5 | Custom Prompt | ✅ IN SCOPE — freeform template with mapped inputs |
| O6 | Translate | ✅ IN SCOPE — text → target language |

## 3. Configuration & auth (✅ grilled)

- **Connections (✅ Q-AI-02):** **model catalog** — builder picks a model per Zap step from
  an offered catalog (multi-provider); **one stored connection per provider** (Q-X-03),
  created once and reused across steps/Zaps.
- **Per-run config:** operation, instruction/prompt template with `{{mapped}}` fields,
  selected model, temperature/max-tokens (advanced, sensible defaults), output mode
  (`result.*` JSON — ✅ Q-AI-03 — or free text).
- **Limits (✅ Q-AI-04):** input **≤ 50,000 chars** (field validation, reject before call),
  **timeout 30s**, token **usage surfaced per run** (`usage.*`), **no hard spend cap**
  (cost visibility only).
- **Guardrails:** provider content refusal → distinct `policy_refusal` class; bounded
  retry-with-backoff on transient provider errors (Q-X-06); `truncated` flag if output
  hits max-tokens.

## 4. Data contract

Input:

```json
{ "operation": "extract", "inputs": { "text": "Ada, ada@example.com, paid $12" }, "instruction": "Pull name, email, amount" }
```

Output:

```json
{
  "result": { "name": "Ada", "email": "ada@example.com", "amount": 12 },
  "resultText": "{\"name\":\"Ada\"…}",
  "ok": true,
  "error": null,
  "usage": { "promptTokens": 120, "completionTokens": 45 },
  "model": "…",
  "latencyMs": 840,
  "truncated": false
}
```

- **JSON mode first-class (✅ Q-AI-03):** classify/extract validate against the field
  list/schema; `result.*` populated with typed values (numbers/booleans coerced);
  `resultText` always present (raw model text).

## 5. Behavior & edge cases

- **Malformed output (✅ Q-AI-05):** one repair attempt (stricter re-instruction) →
  still invalid ⇒ fail `malformed_output` with raw-text snippet (never empty success).
- Empty/whitespace input → validation error, no provider call.
- Input > 50k chars → validation error at field level (clear message, no truncation guess).
- Timeout 30s → `timeout` class after bounded retries on transient errors (Q-X-06).
- `policy_refusal` (provider blocks) → classified error distinct from malformed.
- Catalog model deprecated/unavailable → step-level error suggesting alternate model.
- Prompt-injection: templates delimit untrusted mapped input (documented convention).
- PII: run payloads redacted in logs; provider selection surfaced in run history.

## 6. Acceptance criteria (v1)

- Given mapped text + any of O1–O6, run returns within timeout with contract fields.
- Given classify with 3 labels, `result.label` ∈ labels (or explicit `unmatched` handling).
- Given extract with field list, `result.*` strictly matches the list; malformed ⇒ repair
  once ⇒ `malformed_output` error with snippet.
- Given empty input or >50k chars, pre-call validation error.
- Given provider 429/5xx, bounded backoff; final failure classified; usage always recorded
  on success.

## 7. Open questions — ✅ all answered (round 11)

| ID | Question | Answer |
|---|---|---|
| Q-AI-01 | Operations? | ✅ **All six (O1–O6)** |
| Q-AI-02 | Provider/model strategy? | ✅ **Model catalog, per-step selection; connection per provider** |
| Q-AI-03 | JSON schema mode? | ✅ **First-class `result.*`** |
| Q-AI-04 | Limits? | ✅ **50k chars / 30s / usage surfaced / no hard cap** |
| Q-AI-05 | Malformed output? | ✅ **Repair once, then fail** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-AI-01** `/implement` + `/tdd` — six operations, catalog + connections, templating,
  JSON validation/repair, error classes, usage recording.
- **T-AI-02** fixtures: happy path each op, malformed JSON (repair + final fail), empty
  input, oversize input, provider 429, policy refusal, timeout.
- **T-AI-03** `/code-review` against acceptance criteria (secret handling, logging).
- **T-AI-04** `/pr` referencing this file.
