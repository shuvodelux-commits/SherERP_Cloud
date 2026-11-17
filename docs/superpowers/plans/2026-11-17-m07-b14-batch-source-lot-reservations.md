# M07-B14 — Historical Batch Return Source-Lot Reservation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development, apply test-driven-development RED → GREEN → full verification. No code without an observed failing test.

**Goal:** Before an eventual M03 SQL-atomic return writer exists, reject read-only multi-child Sales Return batches that over-consume the same original lot/consumption-link evidence, even though their individual M07-B12/B13 previews would each succeed.

**Architecture:** Introduce a single M07-only *pure, read-only batch composer* that calls merged `planHistoricalPartialUnitReturn` and `planHistoricalBundleReturn`. It treats each authoritative historical source snapshot as a starting balance, then simulates reservations against copies of original surviving `SALE_ITEM_LOTS` rows in request order, without changing source, DB, stock, refund or ledgers. Fail the entire batch on a declined child; reject contradicting source fingerprints, duplicated return IDs and duplicate/cross-owned source consumption links before accepting any child. Keep the original immutable source-to-lot direction; never rerun current FIFO or infer Cash/Store Credit economics.

**Tech:** JavaScript ES modules; Node `node:test`; GitHub Actions full source/Chromium/local Workerd D1 matrix. **Spec:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `StockLots.gs::planSaleReturnRestoration_` (shared optional virtualState when validating multiple children before first write), `SalesReturn.gs::prepareSalesReturn_`, merged B12 #487 and B13 #496.

## Global constraints and ownership

- **Owner/lane:** M07 issue #314, central #456. Base `main@7c81dca09f975fbda37586eb50c2763c7f8506df`. Upstream B12 #487 and B13 #496 merged with all exact-head 44/44 CI green; current M07 open PR list empty when branched.
- **Exact paths:** `docs/superpowers/plans/2026-11-17-m07-b14-batch-source-lot-reservations.md`, `tests/m07-historical-batch-return.test.mjs`, and after observed RED only `src/modules/m07-historical-batch-return.js`.
- **Read/write scope:** read-only *in-memory* plan, no D1 calls. No edits to B12/B13 implementations, M03 shared `src/db/**`, migrations, posting, `src/rpc/**`, `src/index.js`, Worker bindings, `wrangler*`, M04/M05/M06/M08/finance/UI or original GAS. No new npm dependencies. Never claim actual production atomicity/locking or refund authorization.
- **Integrator:** M03 exclusively owns eventual real SQL-atomic rollback/replay. M02 must first import immutable stable identities, M04 actor rights/Cash Session and M05/M06 source sale snapshots and M08 refund/Party account directions.

## Input/output and invariants

`planHistoricalReturnBatch({tenantId,batchId,entries})` with 2–20 entries, each exactly `{kind,source,intent}` where kind is `MIXED_UNIT` or `BUNDLE`; each source and intent follows existing B12/B13 internal contracts. Single tenant. Child return IDs unique (no replay or duplicate) and source records with the same original immutable identity (tenant/invoice/kind/product or bundle) must be **byte-equivalent in relevant source evidence** at the start, or `NEEDS_REVIEW`. Original source row/link ownership must not collide between *different* origins, even when the physical Lot ID could be shared. Same-origin repeated children deliberately share virtual source balances, so the second child cannot replay the original outstanding quantity.

For a mixed-unit child: run B12 against the latest virtual consumption snapshot; additionally aggregate original conversion unit quantities **used within this batch**, so two children cannot claim three Box from an original sale of two Box even if other units provide enough total base capacity. Update each original source consumption row's virtual remaining quantity and `activeReturnedBaseQty` by exactly its rowIndex/sourceLinkId/lot; all current source/lot totals still reconcile. For a bundle child: run B13 against its virtual component source rows; increase `activeReturnedSets`, decrement only original component source links, and reject total sets beyond sale-time `setsSold`. Every result inherits `financialCalculationAuthorized:false`; no receipt amounts, saved Cash/Bank, Customer/Supplier ledgers, or reservation permission.

On one child decline, the only result is `{status:'DECLINED',childIndex,reason}` (no committed or partially accepted children). On contradictory/unknown original evidence, throw `NEEDS_REVIEW`. On success return frozen `{status:'PLAN_ONLY',data:{tenantId,batchId,children:[{kind,returnId,plan}],readOnly:true,commitAuthorized:false,financialCalculationAuthorized:false}}`. All child plans from B12/B13 are already frozen. No mutation of input snapshots.

## Superpowers steps

- [ ] Commit plan and test-only suite. Test must fail against *actual missing B14 module* on GitHub Foundation Node; verify logs and exact SHA rather than inferring failure.
- [ ] RED test genuine safety cases: repeated B12 partial requests 25 + 100 Pcs from 145 Pcs, newest-lot virtual decrement, second/third over-return, too many boxes, two B13 bundle set returns, third rejected, cross-type identity collisions, duplicated Return ID, contradictory repeated original source, mismatched tenant, invalid request shape, zero monetary authority, frozen results, unchanged sources.
- [ ] Implement minimal pure M07 composer reusing B12/B13. Do not duplicate source receipt/financial writer or create a second correction engine.
- [ ] Run exact-head Foundation, original source policy, all existing 6 real Workerd/D1 shards, browser/Chromium, Cloudflare preview safety and other checks. Document verified RED/GREEN run IDs, fix any M07-owned failure, stop on unrelated cross-lane failures for owner resolution.
- [ ] Open scoped draft PR, file-owner review, no conflicts, all exact-head checks required **before any merge**. Rollback by reverting only these 3 M07-owned files. No public financial availability or staging/production migration.

## Review focus

- Source row identity may not be stable after original GAS → D1 import; this *must not* be treated as SQL locking.
- Earlier active historical returns without their original unit-component breakdown remain outside batch re-attribution. Do not invent a component from current product units.
- A common physical Lot ID across distinct sale line allocations is permissible with **distinct** historical consumption links; cross-owner reuse of the *same link* is not.
- Mixed bundle and standard sale lines must remain separate financial return lines even if the same physical product was sold in both forms.
- Refund amount cannot be inferred solely from unit price because invoice-level discounts, tenders, price revisions and Customer settlements may exist.
