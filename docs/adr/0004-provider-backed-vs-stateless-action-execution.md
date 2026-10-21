# Single Worker Action Engine for Provider-Backed and Stateless Actions

## Context
ZapMate's action catalog includes seven executable action types spanning three credential models:
1. **Stateless per-step configuration** (`Webhook`, `Discord Send Message`, `Email`, `Solana`): Target endpoints, recipient addresses, or webhook URLs live in `Action.metadata` alongside runtime environment keys (`RESEND_API_KEY`, `SOLANA_PRIVATE_KEY`).
2. **Connected provider accounts** (`WhatsApp Send Message`, `Telegram Send Message`): Users connect a `WhatsAppServer` or `TelegramBot` in the editor and configure per-step recipient (`to` / `chatId`) and message templates in `Action.metadata`.
3. **Policy-governed AI execution** (`AI Transform`): Supports platform-managed providers (`openai`, `anthropic`), user-encrypted `AiConnection` records (`openai_compatible` with AES-256-GCM and DNS/IP SSRF pinning), and isolated worker-thread `puter` execution with atomic Redis daily budget reservation.

## Decision
All actions execute exclusively in `apps/worker` via `executeActionWithRetry` and `isKnownActionType`:
- Every action step interpolates `{placeholder}` and `{previousOutput.*}` paths via `replaceKeys` before outbound dispatch.
- Every action returns a structured `{ success, message, output }` envelope persisted into `ZapRun.metadata.stepOutputs[stage]` so subsequent steps and `StepConditionsEditor` filters can chain off prior outputs.
- Unimplemented or unknown action types throw immediately rather than returning silent success, and non-retryable errors (`isFatal` / `AiStepError`) short-circuit `withRetry`.

## Consequences
- `SEEDED_ACTIONS` in `apps/server/src/seed.ts` and `KNOWN_ACTION_TYPES` in `apps/worker/src/utils/actionTypes.ts` are locked in step by automated tests so the UI catalog never offers an action the worker cannot execute.
