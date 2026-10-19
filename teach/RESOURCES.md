# AI Transform Resources

## Knowledge

- [Implementation Completion Report](../reports/ai-implementation-completion.md) — Commit map and verification evidence for every AI Transform phase (PC → PG). Use for: what shipped vs. what is intentionally not production-accepted.
- [Design Spec: AI Reasoning & Transformation Step](../reports/ai-reasoning-step-spec.md) — Canonical decisions D1–D11, action metadata contract (§4.2), prompts (§4.3), output envelope (§4.4), shared execution (§4.5), budgets (§4.7), security (§4.12). Use for: grounding any claim about behavior.
- [Operations & Acceptance Guide](../reports/ai-connection-operations.md) — Setup, limits, privacy/billing, key rotation, rollback, gated E2E. Use for: operator-facing constraints and “billable preview” reality.
- [Shared Package Entry Point](../packages/ai/src/index.ts) — `runAiStep`, `createExecutionState`, provider dispatch and single-repair loop. Use for: authoritative execution flow.
- [Config & Policy](../packages/ai/src/config.ts) — `validateAiConfig`, `readAiPolicy`, `platformModel`. Use for: limits, allowlists, and validation rules.
- [Schema & Validation](../packages/ai/src/schema.ts) — `buildJsonSchema`, `parseJsonText`, `validateAndCoerce`. Use for: how modes become JSON Schemas and how coercion works.
- [Prompts](../packages/ai/src/prompts.ts) — `systemPrompt`, `frameInput`, `PROMPT_VERSION`. Use for: what the model actually sees.
- [Providers](../packages/ai/src/providers.ts) — `callProvider`, `chatBody`, `boundedJsonFetch`, `parseChatResponse`. Use for: request/response shapes per provider.
- [Budget / Redis Lua](../packages/ai/src/budget.ts) — `createDailyBudget`, `RESERVE_AI_CALL_LUA`. Use for: atomic budget accounting.
- [Worker Execution](../apps/worker/src/executeAiAction.ts) + [Worker Index](../apps/worker/src/index.ts) — Replay guard, retry wiring, `executeAiAction` → worker pipeline and `stepOutputs` persistence. Use for: where AI sits in the Zap run lifecycle.
- [Server Validation](../apps/server/src/services/ai.ts) — `validateAiMetadata`, `aiModels`, `previewAi`. Use for: save-time vs preview-time checks.
- [Editor Form](../apps/web/components/metadata/AiMetaData.tsx) — Provider picker, BYOK connection UI, mode/field editors, billable test panel, downstream hint. Use for: what the user actually configures.
- [Zapier AI Skill Vocabulary](../.agents/skills/workflows-ai-by-zapier/SKILL.md) — Origin of `instructions` / `input` / `outputFields` terminology mirrored in ZapMate. Use for: naming rationale.
- [Workflow Execution Gaps](../reports/workflow-execution-gaps.md) — Why unknown action types now fail loudly (D2), output chaining semantics, Gmail outbox prerequisite. Use for: execution-layer invariants.

## Wisdom (Communities)

- [ZapMate E2E Harness (`apps/server/tests/e2e/ai-workflow.e2e.cjs`)](../apps/server/tests/e2e/ai-workflow.e2e.cjs) — Gated real-provider Webhook → AI classify/extract → Webhook test. Use for: seeing the full loop succeed (requires `RUN_E2E=1`).
- Repo-local test suites (`packages/ai/tests/*.cjs`, `apps/worker/tests/aiStep.test.ts`, `apps/server/tests/ai/actions.test.ts`) — Mocked-transport contract tests. Use for: reproducing expected behaviors without spending budget.

## Gaps

- No public post-mortem yet for a live Puter/BYOK production deploy; activation remains gated in this repo. Future lessons should add a case study once verified.
- No end-user video walkthrough of the editor form beyond the static `AiMetaData.tsx` code; a short screen capture would help visual learners.
