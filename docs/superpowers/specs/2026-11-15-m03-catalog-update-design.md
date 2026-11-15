# M03 Guarded Catalog Field Updates — Design

**Date:** 2026-11-15
**Scope:** Internal nonfinancial Product Category / Unit D1 update only; no public RPC.

## Why
The original `legacy/source/Database.gs#updateRowFields_` writes by mutable 1-based sheet row number. During migration, a stale row number can refer to a different record after deletion/reimport. Until authenticated, versioned module workflows exist, a raw 3-argument update interface would risk wrong-record writes. The approved catalog schema already retains distinct immutable source IDs plus `legacy_sheet_row`.

## Approaches
1. Port the three-argument row-index update verbatim — rejected: lacks a stable identity or old-value check.
2. Do SELECT in JS, then UPDATE — rejected: stale-read race.
3. **Chosen:** scoped `createGuardedCatalogUpdateAdapter(env).updateRowFields_(sheetKey,rowIndex,fields,precondition)` with a REQUIRED fourth precondition containing `{sourceId,name,status}`. One fixed parameterized SQL UPDATE uses the physical position + ID + exact old name/status + atomic whole-table provenance guard. This is an intentionally strengthened internal contract, **not** a drop-in port of generic Database.gs.

## Input contract
- Supported sheets: `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` only; `SETTINGS` and financial/Party/POS groups forbidden.
- `rowIndex`: integer 2..1001, matching an existing physical position.
- `precondition`: exactly string `sourceId` and nonblank string `name` plus string `status`; expected strings match D1 exactly, with no case folding.
- `fields`: nonempty plain object containing only the original display-name header (`Category Name` or `Unit Name`) and/or `Status`. Names must be nonblank strings, exact source spelling retained. Status can be `Active` or `Inactive`. No ID, `Created At`, `_rowIndex`, unknown column or arbitrary SQL identifier updates.
- On success returns `undefined` like original `updateRowFields_`. On missing/stale/corrupt source position or invalid input, throw and change nothing. An identical-value update with matching preconditions is valid.
- Never rewrite a whole row; unspecified fields remain untouched. D1 writes must be awaited.

## Safety and boundaries
- One guarded SQL UPDATE ... RETURNING: exact source ID + row position + preimage name/status; all saved source positions must be contiguous from 2 to row-count+1, nonnull, bounded at 1000.
- D1 schema unchanged. No migration, import, deletes, auth, session handling, public Worker route, remote D1 or deployed binding changes.
- Tests run first RED, then GREEN against Node SQLite and real isolated Workerd/D1; verify stale write, wrong source ID, wrong row position, corrupt provenance, invalid field, and preserved unrelated rows.
- This does **not** enable ProductSettings CRUD, general updateRowFields_, financial idempotency, or concurrent M05–M08 development. Explicit preconditions are mandatory when the eventual authenticated module is wired.

**Authoritative source:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M03_PARALLEL_READINESS.md`, original `legacy/source/Database.gs` and `legacy/source/ProductSettings.gs`, pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
