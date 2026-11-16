# M05 — Purchase Item ↔ Stock Lot sell-price provenance audit

Date: 2026-11-16. Scope: internal source-data review only. Branch `m05/purchase-lot-sell-price-provenance-20261116`.

## Twelve-sentence implementation overview

1. This increment follows the frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, not an invented new pricing policy.
2. `Purchase.gs::createPurchase` writes the same validated `sellingPrice` to a `PURCHASE_ITEMS['Sell Price']` cell and to its newly created `STOCK_LOTS['Sell Price']` cell.
3. `PurchaseManagement.gs::updatePurchaseInternal_` replaces the purchase items and updates each existing lot's `Sell Price` for edited products.
4. The source explicitly permits changes to the **remaining** lot sale price after some units have sold because the sale invoice has its own historical price.
5. The proposed audit checks the equality of the current stored original purchase item and the corresponding original purchase lot selling price, without rewriting sold invoices.
6. It uses the original `Purchase ID` and `Product ID` pair to identify the lot and requires exactly one matching active-purchase line/lot for a conclusive comparison.
7. Legitimate zero selling prices must stay distinguishable from missing or malformed source values; the audit never substitutes a current Product default price.
8. Retired zero-quantity lots left when an item was removed during Purchase Update are classified separately from active sale-price evidence.
9. Unknown/orphan/duplicate purchase IDs, duplicate product rows, ambiguous lots and missing legacy pricing cells must fail closed for manual source review.
10. Soft-deleted purchases are counted but skipped from **active** price comparison, since their lot statuses and balances are governed by the separate M07 reversal audit.
11. Tests will be committed before the implementation and the GitHub Actions RED failure, GREEN suite and preview isolation checked on exact commit SHAs.
12. The helper will be read-only, internal, snapshot-driven, and cannot activate public RPC, change original Sheets/GAS, mutate D1 or post financial/stock entries.

## Acceptance and ownership

- New API: `auditPurchaseLotSellPriceProvenance({purchases,purchaseItems,stockLots})` → `{ready,issues,summary}`; inputs are explicit and trusted server/rehearsal snapshots, never browser-authoritative.
- Price comparisons allow at most 0.0000001 BDT floating precision drift (mirrors original source price-change epsilon); a one-paisa difference must fail.
- For **active** purchases, reject missing matching lots, duplicate matching lots and explicit legacy missing price. For **deleted** purchases, report deletion in summary and do not claim active price continuity.
- The prior `auditPurchaseLotLineage` (cost, quantity, supplier/date) and `auditPurchaseInvoiceConservation` (money totals) remain independent. Do not modify them or M05 draft PRs #313/#379/#383/#395.
- TDD: first test-only commit failing because the new module does not exist; second implementation commit; verify exact-head GitHub Node, Workerd/D1, browser, source-byte and isolated Workers preview CI. If unavailable, preserve draft and report incomplete evidence.
- Files created: this plan, `tests/m05-purchase-lot-sell-price-provenance.test.mjs`, `src/modules/m05-purchase-lot-sell-price-provenance.js` only.
- No source GAS or Google Sheets writes; no D1 schema/migration, `src/db/**`, M03 shared posting, M04 auth, Worker RPC, UI, supplier/Party, Cash/Bank or online DB access. No need for Remote Desktop Commander.
- Rollback: delete the three new files, without reversing business data.
- Real purchase D1 transaction/stock/FIFO exact-once integration, source import and multi-unit historic-price snapshots remain independent production gates.
