# M05 — Read-only multi-unit Purchase Update inventory review

Date: 2026-11-16; target `shuvodelux-commits/SherERP_Cloud` branch `m05/multi-unit-purchase-inventory-edit-review-20261116`.

## Implementation overview (12 sentences)

1. The preceding M05 PRs #313, #408 and #416 are merged and cover source-backed optional multi-unit purchase normalization, payment previews and snapshot arithmetic.
2. Existing M05 `planPurchaseInventoryEdit` protects original Purchase Update from editing a sold lot's unit cost, reducing beyond unsold quantities, deleting returned purchases and silently choosing duplicate lots.
3. This increment combines that established inventory guard with existing `prepareMultiUnitPurchasePreflight` rather than building a second correction engine.
4. The frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `PurchaseManagement.gs::updatePurchaseInternal_` remains the authority for stock delta, sold cost and Purchase Return block semantics.
5. Optional unit conversion behavior comes from separately approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` through merged `product-unit-conversions.js`.
6. An internal pure `reviewMultiUnitPurchaseInventoryEdit(purchaseId,payload,snapshot)` will require complete trusted Product, Supplier, Conversion, Purchase, Purchase Item, Stock Lot and Purchase Return arrays.
7. It will reject malformed or accessor records, duplicated current conversion/catalog IDs, missing or ambiguous original purchase IDs, and supplier reassignment because financial-settlement reassignment is not implemented by this read-only helper.
8. It will normalize each proposed mixed-unit line into an authoritative base-stock quantity, cost and immutable unit-factor/pricing evidence before passing exactly those values to the existing inventory edit guard.
9. Legacy single-unit edit lines remain source-compatible and must produce the same inventory stock and cost decisions as the established guard.
10. Reducing a partly sold lot by more than its actual remaining units or changing a consumed lot's unit cost must still be blocked before any stock mutation.
11. The result will be labeled preflight-only and will not claim authorization, payment corrections, Cash Session checks, reversible D1 posting, or source data mutation.
12. Tests will precede implementation, and GitHub Actions RED then exact-head GREEN checks must be verified before an owner-reviewed merge.

## Acceptance contract and impact

- New **internal** API `reviewMultiUnitPurchaseInventoryEdit(purchaseId,payload,{products,suppliers,conversionRows,purchases,items,lots,returns})` returns `{purchase,inventory,mode:'preflight-only'}`; purchase is existing normalized source-compatible purchase proposal, inventory is unchanged `planPurchaseInventoryEdit` output.
- Source-backed test example: initial 145 Pcs mixed-unit cable at base cost `730/145`, partly sold stock lot of original 145 with 20 consumed. A quantity reduction to 140 is eligible, a reduction below 20 consumed (for example 10 remaining from 145) is blocked; changing base cost once consumed is blocked.
- Test existing source Purchase Return, inactive/deleted product/supplier, multiple lots, same-source ID ambiguity, supplier reassignment, conversion tampering, an added product line, price-only unsold correction, unchanged legacy behavior, and no mutation/DB/RPC.
- Strict financial boundary: never create Cash/Bank/Party postings or modify original purchase `Paid Amount` or `Due Amount` based on this inventory review. A later authorized M03/M07 transaction must re-check all conditions atomically, including supplier settlement, auth, cash session, source snapshot preservation, operation ID and exact-once reversal.
- Files: three NEW files only (this plan, `tests/m05-multi-unit-purchase-inventory-edit-review.test.mjs`, `src/modules/m05-multi-unit-purchase-inventory-edit-review.js`).
- No modifications to original GAS/Sheets, M02 schema/migrations, M03 posting/kernel, M04 auth, `src/db/**`, RPC/Worker, frontend, existing M05 modules, preview bindings, financial ledgers or production D1.
- Rollback: revert these three files; zero business data changes.
- RED: test-only commit imports missing module and verifies expected failure in GitHub Actions. GREEN: minimal implementation on same branch, exact-head Node, isolated Workerd/D1, Chromium, source-byte and Cloudflare Preview checks. Never merge on pending/failed checks.
