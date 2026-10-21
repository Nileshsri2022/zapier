# 04: Multi-Seam TDD Verification for Telegram Action

**What to build:**
Lock down Telegram Action behavior across its primary backend and frontend seams with deterministic unit and integration tests.

**Blocked by:** 02: Core Runtime Execution & Run Intake Seam for Telegram Action, 03: Visual Web Editor Metadata Form for Telegram Action

**Status:** ready-for-agent

- [x] Add TDD tests at the primary runtime seam (worker / hooks / processor / server)
- [x] Add TDD tests at the web metadata form and modal routing seam
- [x] Verify full test suite and design-system guards pass with zero regressions
