# Teach — AI Transform Course

This `teach/` workspace holds interactive lessons for the ZapMate codebase, built with the `teach` skill.

## Chapters

| Chapter | Folder | Focus |
|---|---|---|
| **Chapter 01 — How AI Transform Works** | `chapter-01-how-ai-transform-works/` | Pipeline mental model → 4 modes → providers/BYOK → templates & chaining → execution trace (validate/budget/provider/repair/retry/replay) → safety/cost/failures |

Each chapter is self-contained: `MISSION.md`, `GLOSSARY.md`, `RESOURCES.md`, `NOTES.md`, `assets/`, `lessons/0001-*.html`, `reference/*.html`, `learning-records/`.

## How to use

- Open `chapter-01-how-ai-transform-works/lessons/0001-pipeline-mental-model.html` in a browser — all 6 lessons link forward/back and to references.
- Keep `reference/` open for cheat sheets (pipeline, mode chooser, envelope, limits, troubleshooting).
- Each lesson ends with a tangible win + quiz; primary sources are linked to `reports/` and `packages/` (relative `../../../` from lessons).

## Adding chapters

Create `chapter-02-<suffix>/` with the same layout. Update this index.

