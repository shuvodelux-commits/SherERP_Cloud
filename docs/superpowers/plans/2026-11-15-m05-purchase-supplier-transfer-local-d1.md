# M05 — supplier reassignment of a posted purchase, synthetic local Workerd/D1 proof

**Date:** 2026-11-15. **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/PurchaseManagement.gs::updatePurchaseInternal_` explicitly reverses original Supplier purchase due and applies the same gross due to a new Supplier, carrying the entire purchase's stock-lot provenance across even if consumed. It refuses a supplier move when later Supplier payment or credit has been allocated to the purchase. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and `docs/M03_PARALLEL_READINESS.md`. Prior M05 tests #108/#118/#128/#150/#167/#187 merged.

## Scope and safety gate

One two-SKU original posted purchase initially attributed to `SUP-1` with positive original due (e.g., 3,200 paisa), transfer its **unchanged** supplier obligation to an independently reviewed/active `SUP-2`. Source purchase date, quantities, lot costs/FIFO, original discount, paid amount and Cash/Bank tender all stay unchanged. No Customer AR netting even if Customer and old Supplier share Party ID. Preserve immutable source purchase header, original lot records, original Cash/Bank/Supplier ledger for audit; synthetic effective lot and supplier-ledger views display new supplier. Append test-only two-legged original Supplier credit / new Supplier debit audit movements plus operation receipt; update **both Supplier gross payable accounts atomically** (old -= due, new += due), not a single cross-role balance.

This is **not** real Supplier reassignment or a deployment-ready correction API. M03 owns shared SQL and chronology, M04 authorization, M07 native corrections/reversals. Do not change `src/**`, `migrations/**`, `legacy/**`, Worker/public RPC, UI, staging/production D1, or Cloudflare bindings. `PARALLEL-MODULE-READY=false`.

## Database-enforced acceptance and conservative restrictions

- Only one supplier transfer per source purchase. Exact `operationId + canonical intent + actor` replay; changed input returns CONFLICT; distinct second transfer is DECLINED; parallel IDs commit at most one. Uncertain network response or failure -> NEEDS_REVIEW, no speculative new ID.
- Require source purchase and original payable to exist with due >0, original Supplier active and reviewed identity, target **different** Supplier active and reviewed identity, open Cash Session, every source purchase SKU uniquely represented by one original lot whose Supplier ID matches the original source. **Allow consumed original lots:** supplier provenance changes without stock/COGS revaluation. No product stock/version changes, new lots, tender/Customer AR entries.
- Refuse active purchase returns, allocated Supplier payments/credits, any previous synthetic edit/delete/add/remove on same purchase, original or target Supplier later purchase ledger entries whose historical balances would require restatement, missing/ambiguous lot/legacy source link or stale target state. Block other synthetic correction engines after transfer.
- **Late audit INSERT failure** must rollback receipt, both Supplier payable mutations and ledger legs. Tenant isolation, exact identifiers and reason required. No source history is physically deleted.

## Superpowers TDD and CI plan

1. Commit plan before tests.
2. Add 9–11 real Workerd/D1 tests to existing `tests/integration/m05-purchase-multiline-workerd.spec.mjs` importing deliberately absent `tests/fixtures/m05-purchase-supplier-transfer-d1-schema.mjs` and `...-contract.mjs`. Verify real GitHub Workerd **RED** fails `ERR_MODULE_NOT_FOUND`.
3. Implement minimal **test-only** `m05ml_supplier_transfer_*` SQL DDL with DB-enforced claim guards, two-legged supplier accounting+audit and effective views; strict JS claim/lookup using canonical intent hash. Prove success Cash and Bank, consumed-lot provenance, exactly-once replay/conflict/concurrency, stale Supplier/Party/settlement states, source correction collision, later source ledgers, wrong/missing lot, late failure rollback, invalid envelopes and tenant.
4. Full GitHub Actions including actual local Workerd/D1, Node tests, M01 browser/preview checks. Compare diff against advancing `main`, merge reviewed current main if needed, verify exact-head CI, then mark PR ready for review, not auto-merge.

**Four paths only:** this plan, `tests/fixtures/m05-purchase-supplier-transfer-d1-schema.mjs`, `tests/fixtures/m05-purchase-supplier-transfer-d1-contract.mjs`, additive M05 Workerd tests. Rollback: revert four test/docs paths, no deployed D1 data restoration.
