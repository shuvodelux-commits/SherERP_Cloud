# M05 — atomically add one new SKU to a posted purchase (synthetic local D1)

**Date:** 2026-11-15. **Baseline:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `legacy/source/PurchaseManagement.gs::updatePurchaseInternal_` where `c.delta>0 && !c.lot` creates a new supplier-specific FIFO lot dated to the original Purchase. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007 and merged #108, #118, #128, #150. Use owner-mandated Superpowers plan → RED GitHub CI → GREEN → verify → PR.

## Bounded scope

Only **one new Standard product line** (positive integer qty, exact paisa unit and sell prices) added to an existing, unpaid/partially-paid two-SKU source purchase. Original Supplier ID, purchase date, discount, paid amount, Cash/Bank tender, existing source items/lots stay unchanged. Use additive **test-only** `m05ml_add_*` sidecar receipt, movement and audit with a local D1 trigger, a read view for effective item and payable. Generate new stock lot with original purchase date/supplier, increment new product current stock/version exactly once, and increase that Supplier's gross payable by new line cost; maintain source Cash/Bank and independent Customer AR. No other roles netted.

Fail closed if the source purchase was deleted, edited already, or has active returns, allocated settlements, or later same-supplier purchase entries requiring ledger restatement; if Cash Session is closed, Supplier inactive, Party source legacy link unreviewed; if new product missing, inactive, deleted, Bundle, version stale or already in the source purchase/lot; if same operation ID differs or a distinct operation repeats after success. Deny native deletion/edit after a synthetic add receipt to prevent mixed-accounting paths until M03/M07 reconcile them. Same actor/identical intent replay returns REPLAY with no writes. Readback ambiguity returns NEEDS_REVIEW. Database trigger is authority; JS preflight cannot authorize a stale state.

## TDD / acceptance

1. Commit this plan before changes.
2. Add **failing** Workerd/D1 tests for positive three-SKU effective view/lot provenance/stock/Supplier delta, unchanged original and cash/customer balances, exact replay/conflict, concurrent operationIDs at-most-once, stale version/return/settlement/supplier link/session, rejected existing SKU/Bundle/malformed prices and negative/fractional qty, delete/edit collision and injected late audit rollback. Import intentionally missing fixture modules, observe actual GitHub Workerd `ERR_MODULE_NOT_FOUND` RED.
3. Implement only `tests/fixtures/m05-purchase-add-line-d1-schema.mjs` (SQL transaction+triggers) and `tests/fixtures/m05-purchase-add-line-d1-contract.mjs` (strict envelope, hash intent, claim/readback) after RED. Reuse existing test harness, source-shaped purchases, reviewed Supplier account identity. Zero new production code/schema.
4. GREEN must pass real local Workerd D1, other Node/Chromium checks, no-secret Cloudflare PR checks; if `main` changes, compare/merge and run CI on final head. Document proof limitations, rollback and original source behavior.

## Ownership, file impact, remaining gaps

Exactly four paths: this plan; two new fixture modules; add integration cases to `tests/integration/m05-purchase-multiline-workerd.spec.mjs`. Local synthetic `m05ml_add_*` only; no migrations, `src/db/**`, `src/rpc/**`, `src/**`, `legacy/**`, UI, Worker bindings, staging or production data. M03 owns real atomic posting and schema; M07 owns native edit/delete/return/reversal; M04 auth. No production feature approval, no `PARALLEL-MODULE-READY`. Further source parity (multiple new/removed lines, changed supplier/tender/discount, successive edits, ledger chronology and full staff authorization) deferred. **Rollback:** revert these four additive test/docs paths; no deployed DB effects.
