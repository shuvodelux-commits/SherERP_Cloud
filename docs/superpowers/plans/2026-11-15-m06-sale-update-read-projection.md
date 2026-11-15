# M06 Sales Update Mode loader implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Source-faithful, read-only POS Update Mode invoice payload with server-validated editability.

**Architecture:** One native-GAS Node VM reference loader and a pure Worker-safe adapter. Existing `sale-payments.js` handles split payment children; no second sale/payment engine. Input is a trusted tenant-filtered, source-shaped immutable snapshot.

**Tech Stack:** Node 22+, node:test, Node vm/crypto in tests only, ESM pure JavaScript in `src/modules`, existing GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-sale-update-read-design.md`

## Global Constraints

- Frozen original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; never change `legacy/source`, original UI, or its RPC call shapes.
- No modifications to `src/db`, `src/auth`, `src/rpc`, `migrations`, Wrangler, remote D1/staging/production, or financial posting/reversal.
- Server-resolved `sales.edit` authority; no client-provided identity and no automatic Customer/Supplier/Party linking.
- This is a projection ONLY; edit/update must re-authorize and enforce concurrency, returns and stock guards at the future same D1 posting boundary.

## Review focus

1. Duplicate header Invoice ID refuses rather than choosing one row.
2. Open unrelated session never authorizes an invoice created in a Closed historical Cash Session.
3. Original split child rows are integrity-checked, with no implicit backfill for legacy blank-version rows.
4. Historical Bundle revision and vendor source metadata are restored exactly, including source nonnegative total fallback.
5. Deleted or returned invoices and missing/malformed trusted D1 snapshots fail closed.

---

### Task 1: Native reference harness and RED acceptance

**Files:**
- Create `tests/fixtures/m06-sale-update-source-oracle.mjs`
- Create `tests/m06-sale-update-read-model.test.mjs`

**Interface:** `createNativeSaleUpdateOracle() -> { project(invoiceId,snapshot,{canEditSales}) }` invokes *actual pinned* `getSaleForUpdate` with test-only server source mocks; it validates file Git blobs, does no D1 or production imports.

- [ ] Verify the source fixture loads exact `SalesManagement.gs`, `Bundles.gs`, `SalePayments.gs`, `CashSession.gs`, `Utils.gs`; do not mock source `getSaleForUpdate`.
- [ ] Write tests for one standard invoice, cash/bank historical split and legacy blank version, Bundle+Vendor, closed historical Cash Session, stale/duplicate/deleted/returned invoice, bad split children, malformed snapshots, trust/permission and immutability.
- [ ] Commit tests and oracle before module exists, run GitHub Foundation CI, observe expected `ERR_MODULE_NOT_FOUND` for `src/modules/sale-update-read-model.js` (RED).

### Task 2: Minimal pure projection

**Files:** Create `src/modules/sale-update-read-model.js`

**Interface:** `projectSaleForUpdate(invoiceId, snapshot, {canEditSales}) -> source-shaped data`.

- [ ] Validate trusted inputs and edit authority; uniquely select nondeleted invoice; reject active returns; select source historical session based on original Created At.
- [ ] Use imported `readSalePaymentBreakdown_`, source-shaped bundle snapshot and active vendor sourcing, original saved/fallback line totals.
- [ ] Run exact-head GitHub Foundation tests: native reference equal under fixtures (GREEN), all Node tests 0 failed.

### Task 3: CI and PR

- [ ] Check unchanged pinned source manifest, frontend, Cloudflare preview safety and current M03 local Workerd/D1 integration.
- [ ] Check only the five new files appear in PR, no public path or active financial SQL.
- [ ] Open a draft PR with RED/GREEN commits, exact run links, ownership/gates and owner review. No merge until green checks and approval.
