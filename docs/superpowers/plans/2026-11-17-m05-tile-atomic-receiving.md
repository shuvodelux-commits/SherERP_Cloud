# M05-0017 — Atomic tile receiving, synthetic local-D1 proof only

**Dependencies:** M02-14 #439, M03 private read #440, M03 exact D1 proposal #441, and M05 exact purchase-price proposal #442. This is a draft child branch of #442; never merge ahead of the parent. **Canonical source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, Purchase.gs / StockLots.gs; unit supplement sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c. Retain original supplier IDs, source lot date and independent accounts.

## Thirteen-sentence implementation overview

1. Demonstrate an actual **one-statement SQLite/D1** purchase-receipt commit that is indivisible across physical stock, a supplier-specific lot, an inventory movement and an unpaid supplier obligation.
2. Keep every new receipt/lot/ledger table under test-only `m05_tile_test_` names, and add no numbered migration or production database writer.
3. Consume the existing persisted tile measurement and trusted exact purchase quote rather than inventing a second quantity or price calculator.
4. Persist original Pack + Pcs request, complete versioned measurement and price snapshots, exact line amount in BDT minor units, purchase date and operation fingerprint as receipt evidence.
5. Support Box/Carton and Pcs physical entry in this first posting proof, with exact Box, Pcs **or Sqft** commercial pricing from the trusted D1 catalog.
6. Refuse **Sqft-entered area requests** for atomic receiving until their exact rational ceil logic has an equivalent reviewed SQL guard; do not quietly trust a JS-only quantity calculation.
7. Bind an expected active product/unit revision and catalog record version, and reject changes to the persisted selected price after preview.
8. Inside the same SQL trigger, confirm actual Pcs equals entered boxes times the original revision pack factor plus extra pieces.
9. Require a source Supplier ID with a reviewed matching Party legacy link and a synthetic open cash-session gate before recording a credit purchase.
10. Reuse the same D1 receipt+CAS+lot+ledger pattern as the existing M05 test-only purchase atomicity proof, without modifying that original fixture.
11. Bind operation IDs and actor identities to a canonical fingerprint; identical replay never creates a second receipt, while conflicting intent is rejected.
12. Prove concurrent stock-version races, supplier/Party/session changes, stale revisions, immutability and late ledger-failure rollback with actual local Workerd/D1, plus targeted SQLite tests.
13. Leave real bank/cash settlement, discounts, multi-line allocation, production auth, FIFO/OVERSOLD, return/edit/delete, customer AR and live ERP deployment for subsequent source-reviewed SQL-posting integration.

## Impact, SQL boundary and limits

New files are confined to `tests/fixtures/m05-tile-receiving-*.mjs`, `tests/m05-tile-atomic-receiving.test.mjs`, `tests/integration/m05-tile-atomic-receiving-workerd.spec.mjs`, `.github/workflows/m05-tile-atomic-receiving-local-d1.yml` and this plan. There is no source `src/db/` writer, public Worker/RPC exposure, new Cloudflare binding, production D1 migration, original UI edit or original Sheets access.

The test-only contract `createSyntheticTileReceivingPoster(DB,{beforeBatch})` accepts only synthetic server-trusted actor, original Supplier/Product IDs, dated purchase ID, operation ID, expected stock/catalog versions and `{mode:'pack',boxes,extraPieces}`. It first reads `previewTilePurchaseLineCandidateD1`, then posts one receipt INSERT with an AFTER INSERT SQL trigger. The trigger rechecks current unit revision, product catalog version, exact named pack conversion, persisted price text, supplier Party link, session gate and stock CAS **inside the SQL statement**. The trigger writes one lot, one stock movement, one supplier-account debit, plus full immutable quote/request source snapshots; a late failure aborts all effects.

**Financial limitation:** The test fixture handles synthetic **unpaid credit purchases only**, with due = purchase grand total; no real supplier ledger or Cash/Bank book is authorized. A later production M03/M05/M04 integration must review operation IDs, original transaction signatures, roles, cash-session policy, genuine signed payable accounts, fractional lot valuation cost allocation, discounts and all tender types. The source's historical Supplier Ledger debit is not permission to cross-net another Party role. Single-business D1 only; no multi-tenant claims.

## Superpowers TDD
1. Commit plan and tests without schema/contract fixtures, run exact-head GitHub Node CI to show missing-module RED.
2. Add only isolated fixture schema/contract and Workerd integration for GREEN; rerun full Node 22 suite, 84-file source verifier, unchanged frontend build and scoped local D1 workflow.
3. Keep this child PR draft until #441/#442 fully merge, rebase/retest the exact new main head and obtain review before merge. No bypass of pending broad M03 run is implicit; owner previous exception was limited to #439/#440.