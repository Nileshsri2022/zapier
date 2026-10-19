# Mission: Understand How AI Transform Works in ZapMate

## Why
You want to build and debug Zaps that use AI to turn messy trigger data (emails, webhooks, chat messages) into clean, downstream-ready values — without guessing what the step does or why it fails.

## Success looks like
- You can pick the right mode (summarize / classify / extract / custom) for a given automation goal and explain why.
- You can trace a Zap run from trigger payload → AI input template → provider call → validated output → next action, including where budgets and repairs sit.
- You can wire `{previousOutput.fields.*}`, `{stepOutputs.N.fields.*}` and `stepConditions` correctly, and diagnose the three most common failures (empty input, schema mismatch, budget hit).

## Constraints
- Lessons are short, self-contained HTML pages in `./lessons/`; reference sheets in `./reference/` for quick recall.
- Time budget: each lesson should be completable in 8–12 minutes with a tangible win.
- Prefer primary sources and in-repo evidence over parametric claims; link generously.

## Out of scope
- Training or fine-tuning models; prompt-engineering as an art form divorced from ZapMate.
- Building a billing ledger or credit system; deploying Puter/private-endpoint production gates.
