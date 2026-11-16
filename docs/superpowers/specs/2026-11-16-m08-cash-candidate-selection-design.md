# M08 — Cash Reconciliation Candidate Selection (read-only) Design

**Source:** pinned `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `CashReconciliation.gs:getCashReconciliationCandidates`, `cashReconciliationLinkedUsage_`, `cashReconciliationPhaseMeta_`; this repository's frozen `legacy/source` is the reference.

## Purpose

When explaining a cash-session opening or closing discrepancy, the UI needs a list of existing **real** Cash Book transactions, with original selection state and stale-link warnings. This is *not* permission to save a reconciliation, perform a cash movement, retire a legacy adjustment, or alter session expected amounts. Reuse M08 source-parity explanation and overview projections from merged PRs #308/#320. A separate authorized D1/RPC integration is a future gate.

## Approaches

1. Directly port `getCashReconciliationCandidates` including GAS permission calls and Spreadsheet reads: rejected; it must not masquerade as a real authenticated Worker endpoint.
2. Rebuild all reconciliation/accounting logic: rejected; risks a second authoritative financial implementation.
3. **Selected:** an internal pure function `projectCashReconciliationCandidates(sessionRows,cashRows,{sessionId,phase,query,timeZone})` using the merged overview, source-style filters, and a conflict map. Directly compare its output to the original GAS candidate function invoked in the pinned Node VM with fake permission/row APIs and synthetic data.

## Required source behaviors

- Accept only fully loaded source-shaped row arrays; require an explicit trusted business time zone. No hidden caches or async promises.
- Phase is source-style lowercased, exactly `opening` or `closing`; session must exist and its phase needs nonzero difference and positive required amount.
- Source-shaped output: `sessionId,phase,difference,requiredDirection,requiredAmount,selectedEntryIds,staleEntryIds,candidates`.
- Deduplicate stored linked IDs in source order. A selected ID becomes stale when missing, soft-deleted, synthetic (`Session Open`, `Day Close Adjustment`), zero/wrong sign, or linked to *another* session/phase. Reuse in the *same* session/phase is allowed. Stale IDs remain visible as warnings, not selectable by default.
- Candidate list excludes missing IDs, soft-deleted/synthetic/zero/wrong direction and entries already linked elsewhere. Optional case-insensitive query searches Entry ID, Date, Type, Reference, Description. Sort newest source date first, then descending source `_rowIndex`, cap at 250. List `selected` flags and Dhaka-normalized dates.
- Do not filter candidate rows by source session date or owning transaction category: source `getCashReconciliationCandidates` does not do so.
- **Defensive divergence for corrupted imports:** duplicate `Session ID` or `Entry ID` across distinct rows is ambiguous; fail closed rather than silently selecting the first/last matching financial record. Use `Map`/Set rather than prototype-inheriting dictionaries to allow hostile IDs without inherited-property collisions. Document this as a stricter behavior than legacy for malformed data.
- No cash/bank/loan/customer/supplier/vendor/owner balance calculation. No Party auto-net or manual M08-S settlement activation.

## Test and release gate

Test-first, prove RED in GitHub Actions before implementation, then GREEN on a new branch. Test original pinned function via explicit synthetic stubs (only for tests), comparison of full results for ordinary inputs, plus malformed-data fail-closed cases. Verify all affected CI, source verifier, frontend build and no SQL/Worker/public RPC changes. Real D1 financial authorization, atomicity, rollback/replay, ledger reconciliation and cutover remain NOT tested/NOT complete. No live financial data is touched.
