# NOTES.md — Teaching Scratchpad

- User prompt: "use teach skill to explain how AI transform Action works" — they want conceptual + practical understanding, not just code pointers.
- Date: 2026-10-19. Branch: arena/098caac4-zapier. Working directory is repo root `/home/user/zapier`.
- Assumptions:
  - User is comfortable with Zapier/Make/n8n mental model (trigger → actions) but new to ZapMate internals.
  - They can read TypeScript and want to see real interfaces, not just marketing blurbs.
  - English proficiency is high; timezone IST noted but irrelevant.
- Preferences inferred:
  - Prefers concrete examples (order extraction, sentiment classify, WhatsApp summarize) already present in spec.
  - Wants traceable claims — every non-obvious fact should cite a file/symbol.
  - Likes beautiful, Tufte-inspired HTML lessons that print well.

- Teaching plan (6 lessons, each 8–12 min):
  1. Pipeline mental model — where AI Transform sits, why it exists, what it is not.
  2. The four modes — decision guide + schema consequences.
  3. Providers & connections — platform keys vs BYOK, allowlists, gated Puter.
  4. Templates & chaining — replaceKeys, previousOutput/stepOutputs, stepConditions.
  5. Under the hood — validation → budget → provider → repair → retry → replay.
  6. Safety, cost & failure modes — privacy/billing, SSRF/encryption, diagnosing failures.

- Reference docs to create alongside:
  - reference/glossary.html
  - reference/pipeline.html (data-flow diagram)
  - reference/mode-chooser.html
  - reference/limits-and-budgets.html
  - reference/output-envelope.html
  - reference/troubleshooting.html

- Assets needed:
  - assets/styles.css (shared stylesheet, Tufte-like, print-friendly)
  - assets/quiz.js (tiny quiz widget, no external deps)

- Progress: all teaching workspace artifacts created (2026-10-19)
  - [x] MISSION.md, RESOURCES.md, NOTES.md, GLOSSARY.md
  - [x] assets/styles.css + assets/quiz.js (shared, print-friendly, Tufte-inspired)
  - [x] reference/*.html (6 files: glossary, pipeline, mode-chooser, limits-and-budgets, output-envelope, troubleshooting)
  - [x] lessons/0001-0006.html (6 interactive lessons, each 8-12 min, quiz + tangible win, links to refs)
  - [x] learning-records/0001-0003.md (pipeline mindset, mode semantics, provider worlds)
