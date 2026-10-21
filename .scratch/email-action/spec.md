# Specification: Email Action (`AvailableActions.type = "Email"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Email Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Users need a built-in, zero-OAuth way to send transactional email notifications, summaries, and alerts containing dynamic trigger or AI-step data whenever a Zap runs.

---

## Solution

Provide the native `Email` action configured via `EmailMetaData` (`to`, `subject`, `body`) and executed in `apps/worker` (`executeActionWithRetry`) via `@repo/email` (`sendEmailWithTextBody`), interpolating `{placeholder}` variables in `to`, `subject`, and `body`, and recording `{ to, subject, sentAt }` in `stepOutputs`.

---

## User Stories

1. As a Zap creator, I want to select `Email` from the action catalog and configure `to`, `subject`, and `body` in `EmailMetaData` with support for dynamic `{placeholder}` tokens.
2. As a Zap creator, I want `EmailMetaData` to rehydrate existing `to`, `subject`, and `body` values when editing a configured step and validate that required fields are present.
3. As a developer running `apps/worker`, I want the `Email` action to interpolate `{placeholder}` and `{previousOutput.*}` tokens across `to`, `subject`, and `body` before calling `sendEmailWithTextBody`.
4. As a developer running `apps/worker`, I want `Email` action to fall back to extracting an email address from `zapRunMetadata` when `to` is not a direct email literal, and throw an error if `sendEmailWithTextBody` returns `{ error }` so `withRetry` retries up to 3 times.
5. As a downstream step author, I want the `Email` action to return `{ to, subject, sentAt }` in `output` so later steps or run logs can inspect delivery details.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Email Action`, `ZapRun`, and `Outbox` per `GLOSSARY.md` and `ADR-0004`.
- **Placeholder Interpolation Across Recipient, Subject, and Body**: Resolves `{key}` and `{a.b.c}` paths in `to`, `subject`, and `body` via `replaceKeys` before validating `to` or falling back to metadata email extraction.
- **Failure Propagation**: If `@repo/email` returns `{ error }`, the worker throws `new Error("Email send failed: ...")` so `withRetry` performs exponential backoff and marks the `ZapRun` failed if all 3 attempts fail.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Worker Email Execution Seam (`executeActionWithRetry` for `"Email"`)**: Tests direct `to` address, templated `{email}` recipient, fallback metadata email extraction, `{placeholder}` replacement in `subject` and `body`, Resend error retry/failure propagation, and output shape `{ to, subject, sentAt }`.
2. **Web Metadata Form Seam (`EmailMetaData`)**: Tests rendering, input handling, initialData rehydration, and `handleClick` payload emission.

### Prior Art in Codebase
- `apps/worker/tests/processMessage.test.ts`
- `apps/worker/src/index.ts`
- `apps/web/components/metadata/EmailMetaData.tsx`

---

## Out of Scope

- Inbound email receiving (handled by `Gmail Trigger`).
- File attachment uploads in `EmailMetaData`.

---

## Further Notes

- Rate-limited to 80 emails/day via Redis counter in `@repo/email` to protect the Resend free-tier quota.
