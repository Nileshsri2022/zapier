# Specification: Google Sheets Trigger (`Google Sheets Updated Row`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Google Sheets Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Users maintain operational data in Google Sheets (leads, inventory rows, status trackers) and need a reliable way to trigger Zaps whenever a new row is appended or an existing row is edited in place.

---

## Solution

Provide the `Google Sheets Updated Row` trigger backed by OAuth2 account connection, initial row-hash seeding on trigger creation, and periodic SHA-1 row-hash polling in `GoogleSheetsPoller` (`apps/processor`) that emits one `ZapRun` per new or modified row via Run intake.

---

## User Stories

1. As a Zap creator, I want to select `Google Sheets Updated Row` from the trigger catalog, so that spreadsheet additions and edits start my Zap.
2. As a Zap creator, I want to paste either a full Google Sheets URL (`https://docs.google.com/spreadsheets/d/<ID>/edit`) or a raw Spreadsheet ID into `GoogleSheetsMetaData`, and have the ID extracted automatically.
3. As a Zap creator, I want to specify the worksheet tab name (defaulting to `Sheet1`, supporting spaces and single quotes in A1 notation), so that the poller reads the right tab.
4. As a Zap creator, I want `GoogleSheetsTriggersController` to verify my spreadsheet access and seed initial row hashes in Redis when the trigger is created, so that existing historical rows do not flood my Zap on the first poll.
5. As a developer running `apps/processor`, I want `GoogleSheetsPoller` to hash each data row (from row 2 onward) using normalized pipe-delimited SHA-1 (`sheets:trigger:<triggerId>:rowhash`) with a 30-day TTL, so that unchanged rows are skipped and new or edited rows enqueue a `ZapRun`.
6. As a downstream action author, I want each triggered row to provide `{row_number}` and `{row_data.<ColumnHeader>}` in `ZapRun.metadata`, so that I can reference spreadsheet columns by header name.
7. As a platform operator, I want expired Google OAuth access tokens to refresh automatically during polling and persist back to `GoogleSheetsServer`, and per-trigger errors to be isolated so one broken sheet never halts other triggers.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Google Sheets Trigger`, `Trigger ingress`, and `Run intake` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **SHA-1 Per-Row Content Hashing**: Rows are normalized (`(v ?? "").toString().trim()`) and joined with `|` before computing SHA-1. Stored in Redis hash `sheets:trigger:<id>:rowhash` keyed by 1-based sheet row number (`2`, `3`, ...) with a 30-day TTL.
- **A1 Sheet Name Quoting**: `quoteSheetName` wraps sheet names in single quotes and escapes internal single quotes (`''`) so tabs with spaces or punctuation query cleanly.
- **Run Intake Delegation**: `BasePoller.createZapRun` delegates to `enqueueRun({ zapId, metadata, source: "processor.poller" })`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Poller Execution Seam (`GoogleSheetsPoller.poll`)**: Tests active trigger querying, empty/header-only sheets, A1 quoting, new row detection, unchanged row deduplication, in-place row modification, OAuth token refresh, and per-trigger fault isolation.
2. **Server Controller & Service Seam (`GoogleSheetsTriggersController`, `GoogleSheetsService`)**: Tests ownership gating, duplicate prevention, initial hash seeding, and Redis cache invalidation on update/delete.
3. **Web Metadata Form Seam (`GoogleSheetsMetaData`, `extractSpreadsheetId`)**: Tests URL spreadsheet ID extraction, empty-account OAuth prompt, multi-account selector, rehydration, and `canSave` validation.

### Prior Art in Codebase
- `apps/processor/tests/GoogleSheetsPoller.test.ts`
- `apps/server/tests/googlesheets/googlesheets.test.ts`
- `apps/web/tests/googlesheets-form.test.cjs`

---

## Out of Scope

- Outbound Google Sheets row-writing actions (append/update row from worker).
- Sub-minute real-time Drive push webhooks (polling interval is driven by processor cron).

---

## Further Notes

- Row 1 of the target sheet is always treated as the column header row used to key `row_data`.
