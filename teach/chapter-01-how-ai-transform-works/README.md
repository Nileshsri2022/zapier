# Chapter 01 — How AI Transform Works

Suffix identifier: **`how-ai-transform-works`** — the end-to-end explanation of ZapMate's `AI Transform` action.

## What this chapter covers

Six short lessons (8–12 min each) take you from zero to production-safe:

1. **Pipeline mental model** — where AI sits (trigger → outbox → Kafka → worker) and the 3 stores
2. **The four modes** — summarize / classify / extract / custom + field-type coercion
3. **Providers & connections** — platform keys vs BYOK, allowlists, Puter gate, capability profiles
4. **Templates & chaining** — `replaceKeys`, `previousOutput`/`stepOutputs`, `stepConditions`, `[object Object]` trap
5. **Under the hood** — `runAiStep` sequence, one repair, predicate retry, replay
6. **Safety, cost & failure modes** — privacy/billing, SSRF/encryption, 80% fix + rollback

## Contents

- `MISSION.md` — why you are learning this
- `GLOSSARY.md` — canonical terms (AI Transform, envelope, BYOK, repair, replay, …)
- `RESOURCES.md` — trusted sources (specs, reports, `packages/ai`, worker/server, editor)
- `NOTES.md` — scratchpad + progress
- `assets/styles.css` + `quiz.js` — shared Tufte-inspired styling + quiz widget
- `reference/` — 6 printable sheets: glossary, pipeline diagram, mode chooser, envelope, limits & budgets, troubleshooting
- `lessons/0001-0006.html` — interactive HTML lessons
- `learning-records/0001-*.md` — what you have demonstrated

## Start here

Open `lessons/0001-pipeline-mental-model.html`. When you finish chapter 1, propose chapter 2's suffix and mission.

