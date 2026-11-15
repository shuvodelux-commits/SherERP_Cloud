# M05 — atomic purchase soft-delete / reversal proof (local D1 only)

**Date:** 2026-11-15. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/DeleteEngine.gs::deletePurchase` and `legacy/source/PurchaseManagement.gs`. **Depends on merged:** #108 (multi-SKU posting proof), #118 (pure inventory eligibility), M03/M04 baseline. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 and `docs/M03_PARALLEL_READINESS.md`.

## Scope, ownership and rollout

**TEST-ONLY** M05 synthetic D1 reversal evidence. M03 exclusively owns actual `src/db/**`, production D1 migrations and posting SQL; M07 owns native corrections and financial reversals. This plan does not expose a public RPC, edit `legacy/**`, or enable real delete, purchase, return or settlement transactions. No staging/production/preview D1 writes or Cloudflare bindings. A synthetic local D1 trigger proves *one* source purchase-delete variant: fully unsold 2-SKU physical stock + one Cash/Bank payment + Supplier original due. Support only the previously built `m05ml_*` local tables. Never present synthetic proof as an implemented production reversal engine.

## Superpowers tests-first acceptance

1. Commit this plan first. Then write a new integration-only test group in `tests/integration/m05-purchase-multiline-workerd.spec.mjs`, import deliberately missing `tests/fixtures/m05-purchase-delete-d1-contract.mjs`, and add table setup for deliberately missing DDL export. Verify expected `ERR_MODULE_NOT_FOUND` from **actual GitHub Actions RED** before code.
2. Minimal synthetic fixture DDL `tests/fixtures/m05-purchase-delete-d1-schema.mjs` with a keyed purchase deletion receipt (tombstone, reason and actor), one auditable deletion log, active-return and settled-obligation dependency rows, and source-shaped read views that hide voided original Cash/Bank/Supplier entries **without deleting financial history**. The original M05 purchase remains immutable.
3. A single SQL-enforced claim + database-triggered reversal must prove:
   - delete once by unique `(tenant,purchase)` and `(tenant,operationId)`, exact canonical intent hash + actor yields replay; different intent/actor conflicts, distinct operationId cannot delete twice;
   - no consumed source lots (each original remaining equals original qty), enough current stock for every SKU; changed stock after preflight is checked again **inside SQL**, not only in JS; all products and lot quantities reverse together, with per-SKU version increment;
   - no active source Purchase Return or subsequent Supplier settlement, reviewed Supplier legacy link and Open Cash Session; original supplier payable -= original purchase due **without** touching separate Customer AR or other role balance;
   - void all original purchase cash/bank/supplier ledger from **active views** exactly once, but retain immutable rows, original purchase header, lot provenance, actor/reason and audit tombstone; source records are soft-deleted rather than physically removed;
   - late forced deletion audit failure aborts entire claim, stock, supplier, lot and active-view state; concurrent different operationIDs can commit at most one;
   - original source uses `markMatchingDeleted_`, `voidBankEntriesFor_`, `adjustSupplierDue_`, `markRowDeleted_`, `logDeletion_`; sidecar tombstone/views are a **local fixture encoding** of those effects, not the production schema.
4. Real D1 GREEN, zero Node/workerd regressions, all GitHub Actions and no-secret PR preview check. Record RED and GREEN run IDs and number of local D1 cases; PR ready only after complete CI.
5. Explicit gaps: real staff `requireDeletePermission_`, cash-session rules with session exceptions, source account reconciliation/import and purchase returns, partial edit, paid Supplier settlements, legacy pre-lot purchases, source deleted ledger status, reversed Stock Movement entries, M07 single ownership. We **reject** purchases with later allocated Supplier settlement in this synthetic proof (conservative safety rule beyond original DeleteEngine) until M07 policy review.

## File / table / rollback inventory

- Add this plan.
- Add `tests/fixtures/m05-purchase-delete-d1-schema.mjs` and `tests/fixtures/m05-purchase-delete-d1-contract.mjs` **after RED**.
- Extend only `tests/integration/m05-purchase-multiline-workerd.spec.mjs` with additive local-D1 tests/reset.
- New `m05ml_delete_*` and `m05ml_purchase_returns`/`m05ml_purchase_settlements` exist solely in local Workerd D1. No real `migrations/**`.
- Revert these four test/docs paths for rollback. No production data or schema restore. `PARALLEL-MODULE-READY=false`.
