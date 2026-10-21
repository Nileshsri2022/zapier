# 02: Core Runtime Execution & Run Intake Seam for Telegram Action

**What to build:**
Deliver the end-to-end runtime path for Telegram Action: ingress hydration + @repo/runs enqueueRun (for triggers) or worker executeActionWithRetry with placeholder interpolation and stepOutputs (for actions).

**Blocked by:** 01: Catalog Registration & Domain Contract for Telegram Action

**Status:** ready-for-agent

- [x] Interpolate dynamic {placeholder} and {previousOutput.*} tokens cleanly
- [x] Enforce deduplication / idempotency and transactional ZapRun + ZapRunOutbox persistence
- [x] Bound all external HTTP/RPC calls with explicit timeouts and propagate errors for retry handling
