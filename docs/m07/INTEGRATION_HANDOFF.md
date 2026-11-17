# M07 — Returns & Corrections: Final Integration Handoff (B19)

**Disposition: PREPARATION HANDOFF, NOT PRODUCTION COMPLETE**  
**Version:** `m07-b19-v1` · **Base main:** `59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3` · **Module issue:** #314 · **coordination:** #456 · **integration owner:** M03

This document is the human-readable companion to [contracts.json](contracts.json), a machine-checkable inventory of the **actual** M07 contracts and local test evidence present in GitHub. It **is not** an RPC registry, rollout toggle, database migration, transaction posting authorization, approval to import private source data or certification that the ERP can run production returns.

## Decision in one paragraph

M07's independently owned, reviewed preparation covers historical mixed-unit sale/purchase returns, original-lot boundaries, FIFO/batch collisions, bundles and preflight for correction evidence. A merged and green M07 preflight cannot commit stock or financial reversals, nor can it determine authenticated authority, concurrent source changes or replay state. The single M03 shared D1 posting/reversal owner must take possession of all writes **only after** versioned M02/M04/M05/M06/M08 contracts and source reconciliation are accepted. Until those gates pass, `PARALLEL-PREPARATION=READY` and `PARALLEL-SHARED-TRANSACTION-WRITES=BLOCKED` remain the correct state. M07 is **handoff-ready for review**, **not module-production-complete**.

## Frozen source oracles and lineage

- Canonical `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, as copied to `legacy/source/**` in this target repo, remains source of truth for FIFO, purchase, sales, cash, returns, native Sales Return Edit/Delete and source accounting signs.
- Supplementary **owner-approved but not a blanket historical backfill**: `shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` provides mixed-unit source behavior. Do not silently add or reinterpret Bag, Box, Pcs, Sqft or product-specific price/factor history on existing transactions.
- Native `SalesReturn.gs` includes `completeReturn`, `completeReturnBatch`, `updateSalesReturn` and `deleteSalesReturn`.
- Native `PurchaseReturn.gs` includes `completePurchaseReturn`, `getPurchaseReturnHistory` and `getPurchaseReturnDetail`; it does not contain `updatePurchaseReturn` or `deletePurchaseReturn`. B18's edit refusal and proposed cancellation proof do **not** convert absent native functionality into an approved product feature.
- Source monetary direction matters: Sales Return Cash is a Cash Book **Debit** (money out); Purchase Return Cash is a Cash Book **Credit** (money in). Purchase Supplier Credit is a Supplier Ledger **Credit** of the original return and must not mutate a Customer, Vendor, Owner, Lender or Borrower account.
- Original Sales Return stock uses persisted `SALE_ITEM_LOTS` and `SALE_BUNDLE_COMPONENTS` attribution; Purchase Return lot reductions must stay in their own `Purchase ID + Product ID` source lots. No current-catalog FIFO or guessed vendor/OVERSOLD history.

## Concrete exported contracts (all internal; none are active public RPC writers)

| Path under `src/modules/` | Export | Contract tested in |
| --- | --- | --- |
| `purchase-return-lot-plan.js` | `planPurchaseReturnLots` | `m07-purchase-multilot-preflight.test.mjs` |
| `sale-return-correction-evidence.js` | `planSalesReturnCorrectionEvidence` | `m07-sale-return-correction-evidence.test.mjs` |
| `m07-historical-partial-unit-return.js` | `planHistoricalPartialUnitReturn` | `m07-historical-partial-unit-return.test.mjs` |
| `m07-historical-mixed-unit-full-return.js` | `planHistoricalMixedUnitFullReturn` | `m07-historical-mixed-unit-full-return.test.mjs` |
| `m07-historical-bundle-return.js` | `planHistoricalBundleReturn` | `m07-historical-bundle-return.test.mjs` |
| `m07-historical-batch-return.js` | `planHistoricalReturnBatch` | `m07-historical-batch-return.test.mjs` |
| `m07-historical-purchase-mixed-unit-return.js` | `planHistoricalMixedUnitPurchaseReturn` | `m07-historical-purchase-mixed-unit-return.test.mjs` |
| `m07-historical-purchase-batch-return.js` | `planHistoricalMixedUnitPurchaseReturnBatch` | `m07-historical-purchase-batch-return.test.mjs` |
| `m07-historical-purchase-delete-lineage.js` | `planHistoricalMixedUnitPurchaseDeleteLineage` | `m07-historical-purchase-delete-lineage.test.mjs` |
| `m07-purchase-return-correction-evidence.js` | `reviewHistoricalPurchaseReturnCorrection` | `m07-purchase-return-correction-evidence.test.mjs` |

These ten exports are **independent preflight/evidence contracts**; B13/B14/B15/B16/B17/B18 retained their own original-source snapshots and declined/Needs Review behavior. Never convert their `PLAN_ONLY` output into trusted authorization, SQL or immutable replay state. Consult each corresponding existing unit suite for the precise accepted shape and error semantics, instead of guessing a new common RPC payload.

## Existing isolated D1 proof inventory — classification, not release permission

The manifest records **15** `tests/integration/m07-*-workerd.spec.mjs` files: cash/batch returns, source-linked Cash and Store Credit correction/price edits/deletes, Purchase Cash and Supplier Credit returns, multi-lot Cash proof, Purchase Credit deletion, quantity preflight, edit-read and read-only fixtures. Their `tests/fixtures/m07-*` synthetic schemas and `Workerd/D1` execution exercise *isolated, test-only* safety behavior. These tests do not demonstrate that a complete original-sales or purchase Return can be authenticated, posted, edited or reversed through the production Worker against reconciled business data.

Do not report their pass count as a live D1 purchase-return deletion, migrated stock journal, authorized Cash Session or full gross ledger reconciliation. A future integrator must connect a production source import and authority boundary and rerun fresh real D1 integration tests on the **same actual application transaction handler**, not merely the synthetic schema helpers.

## One integration sequence — mandatory owner handshakes

| Step | Owner | Artifact / exact gate to deliver before M07 activation |
| --- | --- | --- |
| 1 | **M02 / M02-P** | Proven source IDs, transaction row lineage, historical unit/lot IDs, approved gross Party role/account mapping and ambiguous identity review |
| 2 | **M03** | Versioned awaited D1 read repository that delivers trusted original persisted Sale/Purchase/Return snapshots, row/version digests and lot links; all mutation surfaces exclusively M03-controlled |
| 3 | **M04** | Trusted authenticated tenant/actor from server credentials; view/create/edit/delete role checks, disabled/revoked users, date/backdate and Cash Session policy verified within a transaction boundary |
| 4 | **M05** | Stable base-unit and per-product Box/Pcs/Sqft conversion snapshots, purchase lot identity, original quantities/cost, source-only FIFO and conditional stock CAS |
| 5 | **M06** | Stable sale consumption/Bundle/vendor/OVERSOLD origin, original invoice and payment breakdown, batch-return and split tender source identities |
| 6 | **M08** | Signed source-linked Cash/Bank, Customer, Supplier and Vendor obligation deltas; separate accounts for advances, owner equity, loans and cross-role settlement; later settlement dependencies |
| 7 | **M03** | **Exactly one** SQL-atomic journal/reservation/reversal kernel with original-operation uniqueness, canonical payload hash, immutable history and no partial effects |
| 8 | **M07+M03+M04+M08** | Native Sale Return correction, Purchase Return creation parity and any separately approved Purchase Return correction design consume the one kernel; tests prove replay/conflict/concurrency, rollback and gross account equality |
| 9 | **M09+M10+M11** | Native UI/report/print parity; authentic 49-group data mapping and source/account reconciliation; staging backup/replay and owner-approved cutover |

M03 owns any proposed shared `src/db/**`, `migrations/**`, `src/rpc/**`, shared posting kernel, stock/invoice ID issuance, D1 binding or Cash Session changes. M07 owns only its read-only/internal source review and M07-scoped test/fixtures. **Do not schedule a second M07 writer or create an independent Sale/Purchase/Return financial correction engine.**

## Mandatory M03 acceptance cases, before any production enabling

1. **Original source and uniqueness:** Same tenant/Purchase/Sale/Return IDs and source-version/hash, no duplicate mixed-unit sources, unknown legacy links or ambiguous original physical stock rows. Preserve original audit row/lot IDs.
2. **Historical units:** 1 Bag (100 Pcs) + 2 Box (40 Pcs) + 5 Pcs = 145 Pcs; separate historical prices total 730 BDT where that actual snapshot is proven; a later configuration change leaves past quantity and money untouched.
3. **Original lot conservation:** Return cannot consume lots from another purchase, restore more than originally consumed, borrow a later vendor/OVERSOLD lot or duplicate a component allocation across batched children.
4. **Cost and money:** Derive financial reversal legs from **stored, source-linked** original monetary entries, not `qty × current unit price`; distinguish Sales Return Cash Debit/Store Credit and Purchase Return Cash Credit/Supplier Credit.
5. **Same-source replay:** `(tenant_id,original_operation_id,correction_id)` canonical payload yields one immutable committed reversal and subsequent `REPLAY` with original result reference **without** a new stock/ledger movement.
6. **Competing source mutation:** Different correction IDs for the same original operation return `CONFLICT`; stale CAS/version or any concurrent Return vs Edit/Delete must conflict or be serializable under the single transaction kernel; never double-restore.
7. **Partial failure:** Inject errors at stock, lot, source, journal, Cash, Bank and Party entry steps; SQL must undo **all** legs, including reservation and audit status, or retain auditable `NEEDS_REVIEW` with no false success.
8. **Security:** Untrusted client actor, permission flags or source IDs cannot supply authority; unauthenticated/revoked/wrong-role/disabled actors are refused within the transaction; Cash Session requirements reflect tenant policy and do not attach to opening historical balances.
9. **Gross accounts:** Reconcile original Customer AR/advance, Supplier AP/advance and Vendor AP/AR separately; no automatic customer-supplier netting, owner-equity/loan mixing or unauthorized cross-role offsets.
10. **Migration & UI:** Original 49 groups, soft-delete logs, row IDs, historical settlement and stock data reconcile; browser original POS/Purchase/Return UI, A4/thermal print and Day Book use the same reviewed source state.

An **M07-GATE-01 through M07-GATE-09** record stays unpassed in `contracts.json` until the assigned integration owner produces actual repository/CI evidence and a reviewed integration PR changes those facts. Do **not** flip these flags in this B19 documentation task.

## Named safety boundaries / blockers

- **Existing source support mismatch:** Purchase Return Edit/Delete is a **new feature requiring an explicitly reviewed separate specification**, not a migrated original function. B18 deliberately declines Edit and previews proposed cancellation only.
- **Not automatically reversible:** Later sales, returned goods that have moved again, bank reconciliations, Customer or Supplier settlements and conflicting correction journals can make a source-shaped preflight unsafe after it was computed. M03 must re-evaluate inside atomic SQL.
- **Party data migration incomplete:** One Party may have seven roles, but each account bucket is separate. Do not derive account direction from Party names/phones or a displayed net.
- **Inert Worker:** `src/rpc/registry.js` is intentionally fail-closed until M04 and M03 evidence; a module export is not a public handler or deployment permission.
- **No D1 cutover:** No actual private business import, remote staging/prod D1 migration, live worker billing/stock writer or release is authorized here.

## Verification and merge policy

B19 adds only `docs/m07/**`, its Superpowers plan and `tests/m07-integration-handoff-manifest.test.mjs`. The test validates the **current** manifest's file/export/source-provenance reality and explicit *false* readiness flags; it does **not** simulate successful stock posting. This is a documentation/contract integrity change; fake failing tests for absent documentation are unnecessary. Require full exact SHA GitHub CI, safe preview isolation, no conflicting changed paths, reviewer approval and PR merge to `main`. Recheck at a later integration PR; a green B19 documentation CI is not a release signal.

**Next owner action after B19 merges:** M03 opens/updates issue #22 with one source-linked original-return posting/reversal interface and its dependencies (#314 for M05/M06/M07, #23/#252 for M04, #66/#452 for M08, #312 for M10). Create one M03-controlled integration PR only after per-module contract signoff; no M07 chat should independently implement shared transaction writes.
