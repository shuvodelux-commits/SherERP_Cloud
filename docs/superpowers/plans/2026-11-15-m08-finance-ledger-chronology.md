# M08 chronological Finance Ledger — Superpowers execution plan

**Goal:** Add source-faithful *internal only* Finance Ledger row projection with correct account-specific running balance even under date/type/person/query filters.
**Constraints:** Frozen source `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; ADR-007 independent accounts; KISS; Github-only commits/PR and CI. **No** public RPC/D1/DB or financial writers. Depends on merged PR #100.

## Task 1 — inspect and RED
1. Review `legacy/source/FinanceModule.gs:getFinanceLedger`, `src/modules/m08-finance-role-balances.js`, pinned M08 test VM, `AGENTS.md`, ADR-007 and gating status.
2. Add `tests/m08-finance-ledger-chronology.test.mjs`, import missing `src/modules/m08-finance-ledger-rows.js`. Use exact pinned source `getFinanceLedger` as VM oracle via explicit synthetic stubs/finance table.
3. Test wrong signs, role netting, same-day business-date/Finance-ID chronology, filtered running balance, no filter summary reset, opening noncash rows, exact Person ID selection, query and unknown/missing/deleted/Promise/date cases.
4. Open draft PR with test-only commit; capture expected `ERR_MODULE_NOT_FOUND` from GitHub Actions **RED**.

## Task 2 — GREEN
1. Create a single pure `src/modules/m08-finance-ledger-rows.js`; import preexisting `projectFinanceRoleBalances` for summary and use compact nine-type signed/label/direction configuration for source shaping.
2. Validate loaded/canonical active data and explicit Person IDs first; sort copied rows Date then Finance ID. Derive all running positions before applying view filters.
3. Return `{rows,summary}` with source-compatible presentation rows, no network/I/O/mutation; rounding after every record.
4. Run GitHub Foundation source tests and fix genuine source differences without weakening RED tests.

## Task 3 — verification and review
1. Verify full Node suite (zero failures), 84-file pinned source audit, frontend build, existing Workerd/D1 and Chromium CI. These do not imply real M08 financial D1 integration.
2. Compare to latest `main`, merge non-overlapping new main changes safely, rerun CI on exact latest head. Do not touch M03/M04/M06-owned files.
3. Document RED/GREEN evidence, source pin, date normalization requirement, source name-only safeguard, four-file impact, no finance writes, rollback. Mark PR ready for owner review **only** after all checks pass. Never auto-merge this new PR.

**Next prerequisites:** owner-approved Party identity/account import, shared SQL atomic posting kernel and auth; future finance ledger authorized D1, then actual financial posting, rollback/idempotency and gross account reconciliation.
