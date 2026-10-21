# ZapMate — Ask-Matt Run: Trigger & Action Specs (Docs-First)

> **Provenance rule:** These docs were authored **only** from the two selection-dialog
> screenshots (Select Trigger / Select Action) and the Ask-Matt flow diagram (screenshot 3).
> **No repository code, config, or skill files were read** — by design. The docs live in
> requirement space so they can be diffed against the existing implementation to reveal
> what is missing, drifted, or over-coupled.

---

## 1. The process being followed (from `/ask-matt`, screenshot 3)

**Main Flow:**

```
/grill-with-docs  →  /to-spec  →  /to-tickets  →  /implement  →  /code-review  →  /pr
     (docs)           (docs)        (docs)        ⛔ GATE         ⛔ GATE       ⛔ GATE
```

**On-Ramps** (not used in this run): `/retro|/triage` (backlog), `/diagnosing-bugs`
(broken), `/wayfinder` (foggy project).
**Upkeep** (not used): `/improve-codebase-architecture`.
**Underlying sub-skills** (called automatically when relevant, never invoked directly):
`/tdd`, `/grilling`, `/code-review`, `/domain-modeling`, `/codebase-design`.

**Mapping to this run:**

| Ask-Matt phase | Artifact in this folder | Status |
|---|---|---|
| `/grill-with-docs` | Open-question blocks in each spec + `03-grill-log.md` (running answer log) | ✅ **complete — rounds 1–16, §X 6/6 + all 14 items** |
| `/to-spec` | `triggers/*.md`, `actions/*.md` — Summary, Events, Config, Data Contract, Edge Cases, Acceptance Criteria | ✅ drafts complete |
| `/to-tickets` | `## Tickets` section at the bottom of every spec + `01-coverage-matrix.md` | ✅ drafts complete |
| `/implement` | — | ⛔ **BLOCKED** until explicit per-item confirmation |
| `/code-review` | — | ⛔ blocked |
| `/pr` | — | ⛔ blocked |

## 2. Rules of engagement (as requested)

1. **All docs before any code.** No trigger/action implementation work happens until every
   spec has been grilled step-by-step and you have confirmed it.
2. **No codebase exploration** while authoring these docs, so the process quality isn't
   degraded by reading what happens to exist.
3. **Step-by-step questions** for every relevant trigger and action, logged in
   `03-grill-log.md` as you answer.
4. **Discord is excluded** — per your instruction, it already follows the process.
5. **Stop point:** ✅ **gate APPROVED (round 17)** — implementation authorized for all 14
   items in listed order (T1→T8, A1→A6).
6. **🪝 Anti-loop mandate (always):** exactly **one** `/code-review` pass; fix **only**
   critical spec omissions / hard-broken rules; ignore style nits & refactors; **never**
   re-trigger `/code-review` or `/tdd` after fixing; go **straight to `/pr`** after the
   first fixes. See `03-grill-log.md` 🪝 section.

## 3. Scope

**Triggers (8):**

| # | Trigger | Spec |
|---|---|---|
| T1 | Gmail | [`triggers/gmail.md`](triggers/gmail.md) |
| T2 | Google Sheets | [`triggers/google-sheets.md`](triggers/google-sheets.md) |
| T3 | Google Calendar | [`triggers/google-calendar.md`](triggers/google-calendar.md) |
| T4 | GitHub | [`triggers/github.md`](triggers/github.md) |
| T5 | Webhook (Catch Hook) | [`triggers/webhook.md`](triggers/webhook.md) |
| T6 | WhatsApp | [`triggers/whatsapp.md`](triggers/whatsapp.md) |
| T7 | Telegram | [`triggers/telegram.md`](triggers/telegram.md) |
| T8 | Schedule | [`triggers/schedule.md`](triggers/schedule.md) |

**Actions (6 in scope + 1 excluded):**

| # | Action | Spec |
|---|---|---|
| A1 | AI Transform | [`actions/ai-transform.md`](actions/ai-transform.md) |
| A2 | Email (Send) | [`actions/email.md`](actions/email.md) |
| A3 | Solana | [`actions/solana.md`](actions/solana.md) |
| A4 | Webhook (HTTP Request) | [`actions/webhook.md`](actions/webhook.md) |
| A5 | WhatsApp (Send) | [`actions/whatsapp.md`](actions/whatsapp.md) |
| A6 | Telegram (Send) | [`actions/telegram.md`](actions/telegram.md) |
| — | Discord | ⏭️ **excluded — follows the process already** |

**Items:** 14 total (8 triggers + 6 actions).

## 4. How to use these docs

1. Read `01-coverage-matrix.md` — it's the "what am I missing" comparison grid (fill the
   right-hand columns against your repo whenever you like).
2. We work through specs **item by item**; I ask the numbered `Q-*` questions from each
   spec and you answer — I record every answer in `03-grill-log.md` and update the spec
   from `draft` → `grilled`.
3. When all 14 are grilled, you give (or withhold) the **final confirmation gate** for
   `/implement`. Until then: docs only.

## 5. Spec template (used by every item)

```
Status / user story
Candidate events or operations   ← the main grill surface
Configuration & auth
Data contract (inputs/outputs + sample)
Behavior & edge cases
Acceptance criteria
Open questions (Q-<ITEM>-nn)
Tickets (post-confirmation only): implement (with /tdd) → code-review → pr
```
