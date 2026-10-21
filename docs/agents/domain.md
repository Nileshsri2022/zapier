# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**Layout: single-context.**

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read the ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-discord-webhook-action.md
│   ├── 0002-ingress-verification-architecture.md
│   ├── 0003-placeholder-resolution.md
│   ├── 0004-zap-composition.md
│   ├── 0005-gmail-trigger-intake.md
│   └── 0006-action-registry.md
├── apps/          ← hook ingress, poller, API, worker, web
└── packages/      ← db, types, ai, runs, ingress, placeholders, email, redis, kafka
```

There is no `GLOSSARY-MAP.md`. The 13 packages are technical layers of one product, not separate
bounded contexts, so one glossary at the root covers them. If a package ever grows its own distinct
domain language, add `GLOSSARY-MAP.md` and switch this file to the multi-context layout.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_

## Specs and grilled decisions

`docs/ask-matt/` holds per-integration specs and grilled decisions. Start at `docs/ask-matt/03-grill-log.md`;
`docs/ask-matt/01-coverage-matrix.md` shows which triggers and actions are already specified. Read these
before proposing a new integration — the decision may already be recorded.
