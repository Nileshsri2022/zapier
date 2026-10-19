# Distinguish platform keys from BYOK connections

The learner understands the D1 single-catalog split (“one type, four providers in metadata”) and the two credential worlds: platform env keys + allowlist/default (openai/anthropic/puter gated by `AI_PUTER_ENABLED`) vs owner-scoped encrypted `AiConnection` rows + typed model ID + exact-host allowlist + capability profile for `openai_compatible`. They can diagnose “not configured” by mapping the table in `services/ai.ts:aiModels` to env/capability checks.

Evidence: lesson 3's quiz and editor flow explicitly tie each “not configured” reason to the code check that produces it; the learner wanted to trace failures, not just memorize them.

Implications: template/chaining, execution-trace, and safety lessons can treat provider selection as settled — the remaining work is connecting the chosen provider's output to the next step, and securing BYOK endpoints.
