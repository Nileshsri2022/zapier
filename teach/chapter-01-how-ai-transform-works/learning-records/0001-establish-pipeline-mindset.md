# Establish a pipeline mindset — AI Transform is not a chatbot

The learner encountered the ZapMate pipeline and internalized that AI Transform is a *stateless data-transformation step* (from the exact system-prompt line in `prompts.ts`) that touches Postgres (stepOutputs), Redis (budgets), and the provider in that order. The key prior misconception corrected was treating AI as a conversational agent with memory — it has none; memory is explicit `stepOutputs[N]` chaining.

Evidence: the user asked for a faithful teaching-track on how AI Transform works, not just API pointers — they already have the spec/reports available. They will need the pipeline mental model before any mode or provider detail.

Implications: future lessons can lean on this model to explain budgets (pre-provider), repair (post-validation but pre-retry), replay (zero-provider cost), and SSRF defenses without re-deriving the pipeline. See Lesson 1.
