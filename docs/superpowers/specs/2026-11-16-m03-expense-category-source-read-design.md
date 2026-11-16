# M03 — Source-shaped Expense Categories D1 read (design)

**Date:** 2026-11-16 · **Workstream:** M03-core #22 · **Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` · **Predecessor:** merged PR #348.

## Original behavior

The original `Database.gs::getAllRows_('EXPENSE_CATEGORIES')` returns source-keyed records with five frozen `Config.gs` columns in sheet order: `Category ID`, `Category Name`, `Description`, `Status`, `Created At`, plus `_rowIndex` representing the **physical one-based sheet row** (data rows start at 2). `findRows_`, `findFirstRow_`, `findRow_` and `findRowIndex_` match by source-header name with `String(value)` exact equality and return the original physical row index. `ExpenseSettings.gs::getExpenseSettingsBootstrap(token)` reads *all* categories (including inactive) after `expense.view`; `Expense.gs::getExpenseBootstrap(token)` derives an active-only selector (status !== `Inactive`). These are distinct projections. Duplicate historical display labels are meaningful and must **not** be combined, sorted alphabetically, trimmed or case-folded.

M02 already merged the source-provenance-aware D1 table `migrations/0005_expense_categories.sql` and a one-shot readback-verified importer `src/db/expense-category-source-import.js`. The current internal `src/db/legacy-catalog-read.js` supports only Product Categories and Units; it already implements the required allowlisted, awaited, bounded, fail-closed legacy helper API and source row-index checks. Thus the missing piece is a third reviewed master entry, not a new database abstraction.

## Approaches considered

1. **Create an unrelated expense-category Sheets emulator** — rejected as duplicated `find*` logic and another attack surface.
2. **Create a public `getExpenseSettingsBootstrap` RPC immediately** — rejected because payee records and complete `expense.view`/tenant-secure authorization and data reconciliation are not migrated; could misrepresent completeness or expose source data.
3. **Chosen: extend only the explicit internal legacy catalog allowlist** with `EXPENSE_CATEGORIES` and the five reviewed source-to-SQL fields. Reuse existing `MAX_ROWS=1000`, `ORDER BY legacy_sheet_row`, `LIMIT 1001`, physical contiguous row validation, existing `find*` methods and never-cached D1. There is **no** public RPC or endpoint.

## Acceptance / security

- SQL is the fixed, literal, reviewed `SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories ORDER BY legacy_sheet_row ASC LIMIT ?`. No arbitrary Sheet/table/column identifiers, no raw SQL input, no source mutation.
- Exactly five source columns and `_rowIndex`, source physical order; preserve duplicate names, UTF-8/Bangla, whitespace, `Status:'Inactive'` and `Status:''`, empty descriptions/timestamps as data, rather than filtering or silently defaulting.
- `getSheetHeaders_`, `getAllRows_`, `findRowIndex_`, `findRow_`, `findRows_` and `findFirstRow_` are async (headers consistent with existing API), return plain source-keyed objects and never leak pending Promises as data.
- Reject non-contiguous, missing/unsafe legacy provenance; reject over 1000 rows, malformed D1 result, incorrect types, unknown columns/sheets, and unavailable DB. No partial result on uncertainty.
- Real local Workerd+D1 test imports a complete synthetic snapshot via M02 importer before reading; verifies precise source identity and byte-for-byte fields, exact ID/label matching, no writes by adapter, provenance corruption failure, and public route absence.
- Keep all code in M03-owned `src/db/legacy-catalog-read.js`, plus new focused Node and Workerd tests and the existing local-only M03 CI job. No new dependencies, no `src/index.js`, `src/rpc/**`, original HTML/GAS changes, D1 DDL, live imports, Party/cash/finance writes, preview binding, or production activation.
- M03 remains incomplete: migrating `EXPENSE_CATEGORIES` reads is not migrating `EXPENSE_PAYEES`, `EXPENSES`, the full Expense bootstrap, staff authorization, or business cutover. Owner approves merge after all exact-head checks.
