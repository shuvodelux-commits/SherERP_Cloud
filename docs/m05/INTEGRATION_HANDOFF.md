# M05 → M03 Private Purchase, Stock, FIFO and Tiles Integration Handoff

**Disposition: NO-GO for live purchases, NO-GO for public financial RPC.** This is a **review-only, source-pinned machine-checked handoff**, not a new financial writer, D1 migration, stock allocation authority, source data import or approval to launch the ERP.

**Version:** `m05-internal-handoff-v1` · **Module:** M05 issue #314 (also source-contract #485) · **M03 integration owner:** #22 · **Cross-lane coordination:** #456 · **Target repository:** `shuvodelux-commits/SherERP_Cloud`.

**Frozen original business source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (Purchase.gs, StockLots.gs, Products.gs, PurchaseManagement.gs, Suppliers.gs, Vendors.gs, DeleteEngine.gs). **Approved optional multi-unit source:** `shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`, especially ProductUnitConversions.gs. Do not substitute a different optional source SHA or retroactively backfill historical transactions.

Read the existing [M05 G1 source contract candidate](G1_SOURCE_CONTRACT_CANDIDATE.md), [M03 G1 shared integrator handoff](../M03_G1_INTEGRATION_HANDOFF.md), [M03 parallel readiness](../M03_PARALLEL_READINESS.md), [parallel execution ownership](../PARALLEL_EXECUTION.md), and [ADR-007 unified Party relationships](../architecture/ADR-007-unified-party-relationships.md). Those remain the authoritative design and safety gates. A green CI run only proves **the code and tests on that exact commit**, not that a historical source export has been verified.

## 1. Concrete private contract inventory

The companion [contracts.json](contracts.json) is the single machine-readable list of **14 existing M05 ESM exports**, each with an actual source file, one principal existing M05 unit suite and a source-method oracle. Its test `tests/m05-integration-handoff.test.mjs` imports every export, checks every unit suite and forces `productionWriter:false` and `publicRpc:false`. M05 introduces **zero new runtime exports** in this handoff.

| Integration interest | Current **internal read/preflight contract** | Real preparation test |
| --- | --- | --- |
| Source-shaped mixed-unit purchase and payment | `prepareMultiUnitPurchasePaymentPreflight` | `m05-multi-unit-purchase-payment.test.mjs` |
| Source-shaped multi-unit purchase preflight | `prepareMultiUnitPurchasePreflight` | `m05-multi-unit-purchase-preflight.test.mjs` |
| Unit-component quantity and price conservation | `auditMultiUnitPurchaseSnapshot` | `m05-purchase-unit-snapshot-conservation.test.mjs` |
| Historical unit receipt against original Purchase Item and stock lot | `auditHistoricalUnitLotHandoff` | `m05-historical-unit-lot-handoff.test.mjs` and `m05-historical-receipt-alias-qa.test.mjs` |
| Original purchase-line and supplier lot relationship | `auditPurchaseLotLineage` | `m05-purchase-lot-lineage.test.mjs` |
| Original stock movement provenance | `auditPurchaseStockMovementProvenance` | `m05-purchase-stock-movement-provenance.test.mjs` |
| Product stock versus original lot balance | `auditSourceStockLotBalances` | `m05-source-lot-reconciliation.test.mjs` |
| One-tenant, one-product historical FIFO evidence | `auditTenantPurchaseFifoEvidence` | `m05-tenant-fifo-provenance-audit.test.mjs` |
| Source FIFO eligibility including Deleted-positive refusal | `planConsistentStockPreview` | `m05-fifo-eligibility-gate.test.mjs` |
| Original purchase invoice conservation | `auditPurchaseInvoiceConservation` | `m05-purchase-invoice-conservation.test.mjs` |
| Tiles canonical Pcs and rational Sqft display | `projectTileStockView` | `m05-tile-stock-view.test.mjs` |
| Tiles historical catalog revisions per Original Lot | `auditTileLotStock` | `m05-tile-lot-revision-reconciliation.test.mjs` |
| Tiles source-D1 read-only purchase line quote | `previewTilePurchaseLineCandidateD1` | `m05-tile-purchase-line-preview.test.mjs` |
| Tiles source-D1 read-only purchase basket quote | `previewTilePurchaseBasketD1` | `m05-tile-purchase-basket-preview.test.mjs` |

**Existing synthetic local Workerd/D1 evidence:** `m05-purchase-multiline-workerd.spec.mjs`, `m05-purchase-posting-workerd.spec.mjs`, `m05-tile-atomic-receiving-workerd.spec.mjs` and `m05-tile-purchase-line-workerd.spec.mjs` in `tests/integration/`. Some mutate a **disposable test database using synthetic m05_* tables**, NOT the approved operational migration or public Shop Worker. They do not prove genuine source D1 purchase posting. The machine manifest deliberately sets `productionPostingProof:false` for all four.

## 2. Immutable source examples — not permission to post

**Mixed units:** from an approved product conversion of 1 Bag = 5 Box, 1 Box = 20 Pcs, `1 Bag + 2 Box + 5 Pcs` is exactly **145 Pcs** canonical stock. At 500 BDT/Bag + 100 BDT/Box + 6 BDT/Pcs this is **730 BDT** (line detail must record original Conversion ID, factor, count, unit price and stock base unit). There is **one Product ID and one canonical base-stock quantity for the purchased product**. Keep original Supplier ID, Purchase ID, Purchase Item and Stock Lot ID and the exact historical effective cost; do not silently convert or round the lot rate to two decimals. A future current unit revision cannot reinterpret old purchases.

**Supplier due:** existing M05 preflight can read an additional original 2 Feet line at 9 BDT/Foot, making 748 BDT subtotal. With 8 BDT discount and 100 BDT tender it shows 740 BDT grand total and 640 BDT due. The source Supplier Ledger and Cash Book Debit column directions are original-specific; they do not imply a Customer AR, Vendor AP/AR, Lender or Owner Equity movement. The M03 and M08 writers must use approved integer-paisa conservation in one reviewed atomic SQL transaction without trusting frontend Number input as money authority.

**Original Lot FIFO:** preserve Purchase Date ascending, then original Lot ID ascending; do not infer Supplier/Party from names or bypass original OVERSOLD, own/vendor/consignment distinctions. The original Stock Movement and Return/Edit/Delete records must refer back to **Original Lot** lineage. Deleted positive-quantity lots are an explicit review blocker. Preserve vendor sourcing and negative OVERSOLD lots as separate semantics, not positive available stock.

**Tiles:** canonical physical quantity is whole Pcs, never Sqft. Historical measurements, box conversion IDs, manufacturer coverage, rational Sqft and revision signatures remain tied to the original lot. Never reprice or recompute history using today's Box/Pcs/Sqft catalog. A mixed historical Tiles measurement can be displayed per lot without inventing a single aggregate area.

**Historical receipt:** PR #739 checks original stored Purchase Items and lots against independently supplied historical unit evidence. PR #750 rejects aliased mutable source/receipt objects, including nested component references. **Neither proves immutable archival custody or authentic historical supplementary unit receipts**. A malicious deep copy of fabricated data may still satisfy consistency audits; M10/M02 must prove source provenance from a separately preserved original archive. M03 must not treat an in-memory `ready:true` or a `postingAllowed:false` preview as an actor-authenticated write grant.

## 3. Exact integration gates and single-writer ownership

| Owner / issue | What the integrator needs before the live writer | Current state |
| --- | --- | --- |
| **M02 #24** | Original source group, physical-row, Supplier and Product identities; reviewed Supplier→Party link; independent Supplier AP/advance account mapping and gross source reconciliation | **BLOCKED** |
| **M03 #22** | Reviewed operational migrations and one SQL-atomic purchase+items+stock lot+movement+Supplier Ledger+Cash/Bank mutation; SQL-bound source IDs, version CAS, immutable intent/operation receipt, replay/conflict/rollback proof | **BLOCKED** |
| **M04 #23** | Trusted Shop and actor from live verified session; current `purchase:add`, revocation/disable/role version, and **Cash Session** check inside the same SQL mutation | **BLOCKED** |
| **M07 #314** | Original purchase/lot attribution, exactly-once return/edit/delete correction and financial compensation without reusing today's units or creating a second reversal engine | **BLOCKED** |
| **M08 #66** | Exact integer-paisa component/discount/tender/due conservation and reviewed source Supplier Ledger direction; separate supplier obligations from other Party roles | **BLOCKED** |
| **M10 #312** | Independent immutable archive receipt/source-ID custody, historical source row reconciliation, repeatable approved restore and no invented units on old rows | **BLOCKED** |
| **M11 #306** | Owner-approved private staging, monitoring, fail-closed rollout and rollback, Cloudflare bindings and full production cutover | **BLOCKED** |

The frozen `Purchase.gs::createPurchase` checks `purchase:add` and calls `requireActiveCashSession_` at entry **even with paidAmount zero or a bank-tender purchase**. A bank payment does not create a Cash Book drawer transaction, but the entry Cash Session check is still part of the original executable source behavior. A change to that source policy requires separate reviewed owner approval; previews must not bypass it. Historical opening balances do **not** get recast as new cash activity.

**M03-only integration order:** (1) review source/Party account mapping and original namespace with M02/M08; (2) verify M04 session, Staff and Cash Session SQL predicates, not a stale preflight; (3) introduce the operational Shop purchase/stock/ledger schema under M03 exclusive file ownership; (4) use trusted server-side D1 catalog revision and source-shaped M05 base quantity/lot semantics inside an **atomic SQL** purchase mutation with idempotent operation receipt and exact money allocation; (5) prove successful and failed last-ledger-leg rollback, zero-row CAS, identical replay, changed-intent conflict, stale lot revision, concurrent purchases, supplier advance isolation and original date/ID preservation in **real local Workerd/D1**; (6) connect M07 return/reversal, M09 UI parity, M10 genuine archive, and M11 cutover **only after** independent sign-offs.

Never expand `src/rpc/registry.js` from its intentionally empty, authenticated-fail-closed state because an internal M05 preflight is green. Current `src/index.js` still marks the public Worker database `not-connected`; no public purchase endpoint, live D1 data, or real business transaction has been enabled by this handoff. On missing/ambiguous original receipt or uncertain operation status, return **NEEDS_REVIEW** rather than retry under a new operation ID and risk double stock/ledger effects.

## 4. Verification and merge request

```sh
node --test tests/m05-integration-handoff.test.mjs
node --test tests/m05-*.test.mjs
# Run the repository full Node suite and existing exact-head GitHub Actions,
# including M01 Chromium, M03 six-shard Workerd/D1, M05 synthetic D1 and Cloudflare PR safety.
```

Review the actual four-path PR diff against concurrent M02/M03/M04/M08/M10 work. `docs/m05/contracts.json` is an **inventory**, not a live service interface or `G1-writer-v1` freeze. Its false release flags must remain false until the relevant source-backed integration PRs and owner-approved production cutover are independently verified. **Independent /super qa → /super review and explicit human-approved merge are required.**
