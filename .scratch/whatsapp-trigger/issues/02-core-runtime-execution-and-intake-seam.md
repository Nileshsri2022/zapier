# 02: Core Runtime Execution & Run Intake Seam for WhatsApp Trigger

**What to build:**
Deliver the end-to-end runtime path for WhatsApp Trigger: ingress hydration + @repo/runs enqueueRun (for triggers) or worker executeActionWithRetry with placeholder interpolation and stepOutputs (for actions).

**Blocked by:** 01: Catalog Registration & Domain Contract for WhatsApp Trigger

**Status:** ready-for-agent

- [x] Interpolate dynamic {placeholder} and {previousOutput.*} tokens cleanly
- [x] Enforce deduplication / idempotency and transactional ZapRun + ZapRunOutbox persistence
- [x] Bound all external HTTP/RPC calls with explicit timeouts and propagate errors for retry handling
