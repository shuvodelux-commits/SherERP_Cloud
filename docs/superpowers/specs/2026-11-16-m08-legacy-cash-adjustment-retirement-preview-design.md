# M08 — Read-only legacy cash adjustment retirement preview

**Source authority:** pinned `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `CashReconciliation.gs:cashReconciliationRetireLegacyAdjustment_` (frozen under `legacy/source`). This is the next source-parity slice after the merged M08 candidate, submission-validation, and closing-recalculation projections.

## Purpose

Original GAS reconciliation may clear legacy synthetic Cash Book entries after a legitimate real-transaction explanation is linked. That historical mutation is **financially sensitive**: in Cloudflare D1 it must eventually be part of an authenticated, guarded, atomic, idempotent operation, not a sequence of spreadsheet-style writes. This slice only analyzes which original rows *would* be retired and which fields the source would update; it never executes an update.

## Decision and alternatives

- Do not port `updateRowFields_`, `LockService`, or any D1 financial writer from the source; doing so without D1 compare-and-swap/transaction guarantees would risk partial accounting state.
- Do not delete historical synthetic rows or change their original identifier/reference. The source clears two numeric movement cells and appends an audit description.
- **Chosen:** a pure `previewLegacyCashAdjustmentRetirement(cashRows,{sessionId,phase})` returning source-shaped `[{table:'CASH_BOOK',rowIndex,fields:{Debit:'',Credit:'',Description:'...'}}]`. This structure is **explanatory only**, not an authorization token or executable patch. Use a sandboxed test-only VM implementation of the exact frozen source function with `updateRowFields_` stubbed to collect expected calls; compare the full output for normal fixtures.

## Source behavior

- `phase==='opening'` targets `Type:'Session Open'`; `phase==='closing'` targets `Type:'Day Close Adjustment'`. Every candidate must have `Reference` matching source-coerced `String(sessionId||'')`, and must not be soft-deleted (`true` or case-insensitive `TRUE`).
- Only rows with **nonzero cent-rounded `Credit - Debit`** are eligible. If movement has already been cleared, return no proposal for that row; this makes a post-retirement preview empty.
- Preserve Cash Book **array order**, row index `Number(_rowIndex) || arrayIndex+2`, source field values `Debit:''`/`Credit:''`, and description `trim(existing)` plus ` — legacy automatic adjustment retired by Cash Reconciliation` or that text alone when blank.
- Do not constrain by entry ID, dates, cash signs or session status beyond the frozen source's filters. Cash Book rows can be imported with blank Entry IDs. No sort, summation or invented rollback side effect.

## Defensive hardening (source-compatible on valid records)

- Require explicitly `opening` or `closing`, and a nonempty session reference. The original silently treats invalid phases as closing, which is too dangerous for a future financial operation.
- Fail closed when records are unresolved Promises/non-arrays/nonobjects, when duplicate nonempty Cash Book Entry IDs exist, when target rows resolve to the same `rowIndex`, or when a target row has an invalid/nonpositive/noninteger source index. This **intentionally differs from source on malformed imported data**. No silent guess of which financial row to retire.
- Return new immutable-in-practice value objects without mutating frozen input or linking to any user-controlled SQL identifier. Internal only, no RPC, D1, frontend, or external network.

## Acceptance and release blockers

- Follow Superpowers GitHub-first TDD: design+plan, test-only RED commit, inspect GitHub Actions `ERR_MODULE_NOT_FOUND`, minimal GREEN implementation, full `npm test`, `npm run verify:source`, `npm run build:frontend`, PR for owner review.
- Frozen-source VM stubs are a **test oracle**, not a production writer. This read-only view does not prove authentication, tenant isolation, snapshot validity, transactional retirement+explanation linkage, idempotency, replay, rollback, financial audit, or actual D1 integration. Those require a separately approved M03/M04/M08 controlled write implementation with real D1 tests.
- Leave Unified Party separate account balances and manual M08-S cross-role settlement untouched/disabled; historical balances do not become cash movements.
