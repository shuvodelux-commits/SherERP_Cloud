# M05 — Source-shaped Purchase History list with mandatory settlement evidence (2026-11-16)

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` original `PurchaseManagement.gs::getPurchaseManagementList`, `SupplierSettlement.gs::supplierSettlementState_` / `supplierPurchaseSettlementSnapshotFromState_`, `Utils.gs::safeDateOnly_`. **Target:** `shuvodelux-commits/SherERP_Cloud` on current main after merged PR #360. Review `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007. Do not modify protected source, production data or shared M03 owner paths.

## Thirteen-sentence implementation overview

1. The existing Purchase History screen uses `getPurchaseManagementList` from the frozen PurchaseManagement GAS module rather than the new-purchase bootstrap.
2. It reads active Purchases and active Purchase Returns, aggregating each return amount by the original Purchase ID.
3. It computes Return Status as No Return, Partially Returned or Fully Returned without inventing another financial entry.
4. For a supplier-linked purchase with original Due Amount greater than 0.004, the source queries the supplier settlement state and replaces displayed paid, due and payment status from that authoritative settlement result.
5. A purchase without eligible outstanding supplier dues shows its stored direct payment fields unchanged.
6. The source sorts rows by normalized date descending while preserving their incoming order for equal dates.
7. Implement an internal `projectPurchaseManagementList` over already tenant-scoped trusted Purchases, Purchase Returns and optional independently reconciled per-purchase settlement rows.
8. Eligible purchases must have a single matching settlement evidence record with matching original Supplier ID; without one, preview must fail closed rather than displaying stale financial balances.
9. Preserve original Purchase IDs and signed/zero source amounts; do not collapse Supplier role balances with any Customer, Vendor, Owner, Lender, Borrower or Payee account.
10. Duplicate active Purchase IDs, duplicate settlement evidence, orphan active returns, invalid or ambiguous dates and nonfinite monetary values must block readiness for imported data review.
11. A test-only VM will run the pinned GAS function itself, with synthetic trusted settlement helper responses, and compare the full source row shape, ordering and business calculations.
12. Commit tests before implementation and observe an expected RED GitHub Actions failure, then implement the minimum GREEN pure module and verify exact-head tests and preview checks.
13. Do not add D1 schemas/queries/writes, public RPC, authentication shortcut, stock or cash/bank posting, Cash Session changes, UI redesign or production migration in this increment.

## Input/output contract

- `projectPurchaseManagementList({purchases, returns, settlements})` returns source-shaped `getPurchaseManagementList.data` array; `settlements` is an explicit array of verified `{purchaseId,supplierId,paidAmount,dueAmount,paymentStatus}` records, one for each active purchase requiring settlement.
- Missing `settlements` is permitted only if **no active purchase** requires it; no client-supplied settlement state may be used by the future RPC adapter.
- Soft-deleted header and return rows are excluded before matching. Date fields must be canonical `YYYY-MM-DD`, already normalized by a trusted source importer (native `safeDateOnly_` may also normalize timestamps, but this helper deliberately refuses unreviewed ambiguity).
- Duplicate IDs and malformed nonfinite balances fail closed. No hidden Sheet or database fallback, no conversion to Party net due.
- No `src/db/**`, SQL migrations, `src/rpc/**`, `src/auth/**`, frontend, original GAS, `src/index.js` or cash/bank/ledger changes. This is not connected to public endpoints.
- New files: `src/modules/m05-purchase-history-list.js`; `tests/m05-purchase-history-list.test.mjs`; this plan.
- Rollback: revert the three new files; no data or posting side effects.

## Acceptance and remaining gates

RED: verify expected `ERR_MODULE_NOT_FOUND` on GitHub commit before module creation. GREEN: source-VM full-field parity for active and deleted purchases, returns, exact 0.004 threshold, settlement update, equal-date stable sorting, paid/due independent accounts, trusted snapshots and immutability. Verify Node, source SHA, Worker, Chromium and Workerd D1 CI on exact HEAD before owner review. Live M05 purchase posting remains blocked by M02 versioned source-shaped transaction schema, M03 DB-level atomic idempotent kernel, M04 auth/cash-session policy and M07 returns integration. Multi-unit PR #313 remains a separate dependency. No production-ready claim from read-only synthetic tests.
