# M07-P0 Source Contract Preparation — Execution Plan

**Date:** 2026-11-15
**Spec:** [M07 preflight design](../specs/2026-11-15-m07-native-returns-preflight-design.md).
**Business contract:** [M07 source/impact matrix](../../M07_RETURNS_SOURCE_CONTRACT.md).
**Dependencies:** merged source/M03 foundation only; M05/M06/M04 financial gates remain blocked.

## Task 1 — Isolate M07 source characterization

**Files:** `tests/m07-native-return-source.test.mjs`; read-only `legacy/source/{SalesReturn,PurchaseReturn,DeleteEngine,SalesManagement,StockLots}.gs`.

1. From fresh `origin/main`, create independent `m07/returns-source-contracts-20261115` worktree; do not touch M06, M08 or shared `src/db` files.
2. Execute frozen original source in `node:vm` with only the external GAS perimeter simulated. Use hand-derived expected outputs.
3. Cover exact gross sale line pricing, editable return-price upper bound, original-purchase-lot FIFO and no cross-purchase depletion, missing Sale Return reversal evidence, batch cardinality, duplicate IDs and max lines.
4. Run focused Node tests. Perform a temporary local source mutation to demonstrate that at least one test detects behavioral change, restore source immediately, then rerun green.
5. Record that these are **Node characterization only**, not D1 rollback or financial parity proofs.

**Expected:** tests are deterministic and no source/production files are modified or staged.

## Task 2 — Document native RPC and table ownership

**Files:** `docs/M07_RETURNS_SOURCE_CONTRACT.md` and the spec above.

1. Map native Sales Return/Purchase Return/edit/delete entrypoints, source data groups, original test names, separate customer/supplier/vendor obligation impact.
2. Define exact once, stale version, concurrency, source lot, Cash/Bank/Party and soft-delete acceptance cases.
3. Preserve the source's cash-on-unpaid-sale rule, multi-invoice eligibility and split-payment restriction.
4. Explicitly defer production schema, migrations, `src/db`, `src/rpc` and Worker changes until the shared kernel owner freezes contracts.

**Expected:** neither a generic correction engine nor any unreviewed ledger offset is introduced.

## Task 3 — Verification, review and PR

**Commands:**
```bash
node --test tests/m07-native-return-source.test.mjs
npm test
npm run verify:source
npm run build:frontend
git diff --check
git status --short
```

**Expected:** full Node suite and source/frontend checks pass, no mutation to `legacy/source`, `migrations`, `src/db`, `src/rpc`, or deployed Worker. PR must enumerate files/RPC/tables, pinned source SHA, exact evidence and absent real D1 tests; no auto-merge.

## Subsequent M07 implementation sequence (not part of this PR)

1. **M07-A:** blocked-to-real-D1 Sales Return create/partial/full/batch with source lot/Party/tender readback against frozen M05/M06 schema; RED first then full Workerd D1 green.
2. **M07-B:** native `getReturnForEdit`, `updateSalesReturn`, `deleteSalesReturn` and Day Book dispatch; SQL CAS/immutable receipts, optimistic versions and exact undo; preserve batch siblings.
3. **M07-C:** Purchase Return source purchase-lot reductions and Supplier Credit/Cash; independent supplier account reconciliation and rollback.
4. **M07-D:** native invoice/purchase edit/delete dependency guards, all tender/vendor/ledger/stock rollback, audit deletion and browser UI parity; no duplicate correction engine.
5. **M07-E:** full original fixture reconciliation + concurrent/replayed/failure-injected Workerd/D1, source-snapshot UI regression and staged owner-reviewed migration.

**Release prohibition:** no M07 financial RPC can be exposed until M04 authenticates the actor within atomic SQL writes, M05/M06 posting and M02-P Party source links are reviewed, D1 fixtures reconcile and the owner approves rollout/rollback.
