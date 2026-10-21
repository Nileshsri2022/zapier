# T2 — Google Sheets (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T2 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when rows appear in a Google Sheet.

> **As a** Zap builder, **I want** my Zap to fire when a row is added to a spreadsheet I
> choose, **so that** row data can drive downstream actions without manual exports.

## 2. Trigger events — ✅ grilled (Q-SHEETS-01)

| # | Event | v1 verdict |
|---|---|---|
| E1 | New Spreadsheet Row | ✅ **IN SCOPE** — the only v1 event |
| E2 | Updated Spreadsheet Row | ❌ backlog (updates never fire in v1) |
| E3 | New or Updated Spreadsheet Row | ❌ superseded by E1-only |
| E4 | New Spreadsheet | ❌ backlog |

## 3. Configuration & auth (✅ grilled)

- **Connection:** Google OAuth on the **shared per-provider Google connection**
  (Sheets + Drive readonly for file listing; Q-X-03).
- **Per-Zap config:** spreadsheet (picker), worksheet/tab, include-empty-rows (Y/N).
  ~~Trigger column~~ — ❌ out of v1 (✅ Q-SHEETS-02: whole sheet only; returns when
  update-events ship). Header row auto-detected with headerless fallback (✅ Q-SHEETS-04).
- **Cursor:** **row-number watermark only** — fired rows are `rowNumber > watermark`
  (no content hashes needed since edits don't fire). Stored per Zap step.
- **Size:** soft warning when sheet ≥ 10k rows (✅ Q-SHEETS-05) — works beyond, UI warns.

## 4. Data contract

Output fields (one run per new row):

```json
{
  "spreadsheetId": "1AbC…",
  "spreadsheetName": "Leads",
  "sheetName": "Sheet1",
  "rowNumber": 17,
  "rowData": { "Name": "Ada", "Email": "ada@example.com", "Score": "12" },
  "rowArray": ["Ada", "ada@example.com", "12"],
  "event": "created",
  "timestamp": "2026-10-21T09:14:02Z"
}
```

- `rowData` (header-keyed) **and** `rowArray` both always present (✅ Q-SHEETS-03).
- **Headerless sheets (✅ Q-SHEETS-04):** `rowData` falls back to `col_1..col_n` keys;
  `rowArray` unchanged.
- `event` is always `"created"` in v1 (field reserved for future `updated`).
- `changedCells` **removed** from v1 contract (update-events not in scope).

## 5. Behavior & edge cases

- **Dedupe:** watermark on `rowNumber`; a row fires exactly once (append-only semantics).
- Row deleted between polls → ignored (no event class for it in v1).
- Header renamed mid-run → values keep the **snapshot** of headers taken at setup
  (headerless fallback if headers vanish).
- Sparse/empty trailing rows skipped (unless include-empty-rows opted in).
- Whole-sheet reads scale poorly: soft 10k warning; poll must page through API (quota aware).
- Shared drives & permission loss → auth-class error.
- Formula re-evaluation / in-place edits → **no effect** (v1 fires only on new rows).

## 6. Acceptance criteria (v1)

- Given a newly appended row, exactly one `created` run with both `rowData` + `rowArray`.
- Given an edit to an existing row, **no run** (E2 out of scope).
- Given a headerless sheet, `rowData` uses `col_1..col_n` keys; `rowArray` correct.
- Given permission loss, actionable auth error.
- Given sheet ≥ 10k rows, soft performance warning surfaced at setup.
- Field mapper exposes all contract fields.

## 7. Open questions — ✅ all answered (round 4)

| ID | Question | Answer |
|---|---|---|
| Q-SHEETS-01 | Which events in scope? | ✅ **E1 New Row only** |
| Q-SHEETS-02 | Watch whole sheet or trigger column? | ✅ **Whole sheet only** (no trigger column in v1) |
| Q-SHEETS-03 | Row output shape? | ✅ **Both object + array** |
| Q-SHEETS-04 | Header-less sheets? | ✅ **Supported** via `col_1..col_n` fallback |
| Q-SHEETS-05 | Size caps? | ✅ **Soft warning at 10k rows**, no hard cap |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-SHEETS-01** `/implement` + `/tdd` — append detection (watermark), headerless fallback,
  dual-shape contract, 10k soft warning.
- **T-SHEETS-02** fixtures: append, headerless sheet, permission loss, large-sheet warning.
- **T-SHEETS-03** `/code-review` against acceptance criteria.
- **T-SHEETS-04** `/pr` referencing this file.
