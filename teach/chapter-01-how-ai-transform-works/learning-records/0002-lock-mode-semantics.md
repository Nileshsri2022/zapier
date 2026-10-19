# Lock mode semantics — summarize / classify / extract / custom

The learner can now choose the correct mode by asking what the downstream step consumes (paragraph, label, named values, bespoke), and sketch the corresponding schema (fixed `{category:enum}` for classify, strict JSON Schema with nullable optional fields for extract, plain-text fallback for custom-without-fields). The common stumbling block addressed is over-using custom+fields when plain extract suffices.

Evidence: the Mode chooser reference and Lesson 2 exercises show the four cards mapping directly to `prompts.ts` system lines + `schema.ts:buildJsonSchema` + `validateAndCoerce` coercion rules (bare numbers, booleans as "true"/"false"), which the learner applied in the recipe pair.

Implications: provider and template lessons can now assume the learner knows how OutputFields become schemas and what `output` vs `fields` means — they will not need re-teaching on “why two forms?”.
