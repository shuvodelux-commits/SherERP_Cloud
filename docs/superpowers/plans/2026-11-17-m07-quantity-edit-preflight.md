# M07-B9 — Read-only Sales Return Quantity Edit Preflight (Isolated Workerd/D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development; RED test first, verify failure, minimal GREEN, exact-head CI.

**Goal:** Establish a source-bound, read-only readiness calculation for Cash / Store Credit Sales Return *quantity* edits before authorizing any inventory or financial mutation.

**Architecture:** Reuse M06 invoice, M07 Cash and Store Credit, M07 source lot/restoration and B2/B3 deletion, B6 version, and B7/B8 price revision fixtures. Read a single tenant-scoped local D1 snapshot; compare immutable source/return/movement against current returned lot quantities and available shop/lot stock. A proposed new quantity may increase returned stock only within sold minus active returns; it may decrease returned stock only while every original restored unit remains available in its linked lot and shop stock. Store Credit checks original Customer signed role, reviewed Party link and later-ledger restrictions; Cash validates refund evidence. Read-only result is a **plan**, not authorization for D1 writes, UI editing, accounting totals or eventual posting.

**Tech:** Node ESM test, Wrangler isolated local Workerd + disposable D1; no production D1 bindings.

## Overview (13 sentences)

1. The frozen `SalesReturn.gs::prepareSalesReturnChange_` uses an exact source-linked stock undo planner whenever return item quantities change.
2. The original `STOCK_LOTS` and `SALE_ITEM_LOTS` cannot be replaced by a guessed FIFO calculation.
3. A synthetic single SKU and single source-lot fixture can establish the required feasibility invariants without claiming support for bundles or vendors.
4. Increasing return quantity consumes additional original sale capacity and restores that many additional units.
5. Decreasing return quantity removes previously returned units from the same original return lot and shop inventory.
6. A reduced return is not feasible if restored units have already been resold or allocated, even when other shop lots still have stock.
7. The total returned units for a source lot must reconcile with all active immutable return movements, excluding audited deleted corrections.
8. The source invoice hash, sold item quantity, original return unit movement and refund or credit ledger must be exact.
9. Cash and Store Credit use separate financial evidence; Store Credit also requires the original Customer, reviewed Party link and unambiguous signed balance.
10. A stale edit version, closed current Cash Session, deleted return, later unsupported correction or post-return settlement blocks planning.
11. Proposed quantities must be positive integers bounded by the original source sale quantity and remaining unreturned capacity.
12. The projected `deltaUnits` and required direction are computed without a D1 mutation or public Worker RPC.
13. Real cash/customer amount changes, authorization, lot-consumption snapshots, batch siblings, original-date Cash Session, and production quantity edits remain separate approval gates.

## Task 1 — RED

- [ ] Commit this source contract to `docs/superpowers/plans/2026-11-17-m07-quantity-edit-preflight.md`.
- [ ] Add only `wrangler.m07-quantity-preflight-test.jsonc` (unique local Workerd D1) and `tests/integration/m07-quantity-preflight-workerd.spec.mjs`, with one aggregate import in `tests/integration/m03-workerd.spec.mjs`.
- [ ] Tests: Cash shrink/expand, Store Credit shrink/expand, exact source lot/stock changes untouched, other active return capacity, resold restored lot, different tenant/lot, version drift, Closed Session, amount/ledger tampering, deletion, source hash and refund-movement mismatch, price revision and later Customer ledger, invalid fields, no exposed route.
- [ ] Commit tests **without** `tests/fixtures/m07-quantity-preflight-contract.mjs` and verify expected RED failure in the GitHub M03 Workerd job.

## Task 2 — GREEN

- [ ] Export `createSyntheticD1ReturnQuantityPreflight(DB).plan({tenantId,returnId,newUnits,expectedVersion})`.
- [ ] Input exact-key validation, strict IDs/integers, parameterized read-only SQL, fail-closed ambiguous/missing history, signed Customer and refund source consistency.
- [ ] For valid request, return `{status:'PLAN_ONLY',data:{returnId,invoiceId,refundMethod,lotId,oldUnits,newUnits,deltaUnits,action,editVersion,readOnly:true,commitAuthorized:false}}`.
- [ ] For no real quantity change return `DECLINED`, for missing/other tenant `NOT_FOUND`, for incomplete/corrupt history `NEEDS_REVIEW`, stale version `STALE`, and stock/capacity/session/policy constraints `DECLINED`.
- [ ] No D1 writes. Run exact-head Foundation Node tests and source checks, real Workerd, Cloudflare build isolation and Chromium smoke; investigate every genuine failure and fix using TDD.

## Task 3 — Review

- [ ] Draft PR with source authority, RED/GREEN SHAs, CI run links and status.
- [ ] Owner to review and merge only when checks green. No production `src/**`, Worker RPC, D1 migrations/bindings, original GAS/Sheets, original UI changes or remote D1 writes.

## Limitations and safety

This is only a synthetic one-lot/one-SKU calculation and **cannot** certify production physical stock reversal. It does not back out original batch sibling returns, multi-unit conversion, bundles, multi-supplier stock FIFO, source `SALE_ITEM_LOTS`/vendor sourcing, Cash Book/Customer Ledger re-posting, audit logs, historic Cash Session status or M04 authenticated actor. Existing B7/B8 price revisions cause quantity preflight to decline until combined version-aware source journal treatment is designed. M02 source-ID import, M03 unified writer, M05 stock-lot provenance, M06 tender, M08 ledger settlements and M09 return UI remain blockers. Never infer a Customer from Party display and never cross-role settle.
