# M05 — Source-faithful Product Unit Price Profile (internal only)

Date: 2026-11-17. Scope: one independent, source-adapted pure module plus tests. Tracking: #314.

## Superpowers implementation overview (12 sentences)

1. PR #425 is the existing M05 purchase inventory edit preflight and remains a separate merge/CI gate.
2. The approved supplementary source is shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c, ProductUnitConversions.gs.
3. Canonical Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 still owns existing purchase, stock, FIFO and financial semantics.
4. Product add/edit price anchors and per-unit overrides have not been ported in the existing internal product-unit-conversions.js quantity and sale/purchase preview functions.
5. This increment ports the original productUnitOptionalPrice_ and normalizeProductPriceProfile_ bodies without changing their input/output behavior.
6. A local sanitizeInput_ compatibility helper replaces the original GAS global dependency.
7. Independent purchasePriceUnit and sellingPriceUnit select exactly which unit carries the user-entered price.
8. The returned canonical stock-unit cost can retain more than two decimals, including 70 BDT / 16 Gira = 4.375 BDT.
9. Exact source-unit anchor prices are retained on their corresponding conversion rows to avoid price drift during product edits.
10. Explicit stock-unit and nonanchor unit price overrides remain independent, with original source error cases preserved.
11. Tests are committed first and must show the absent-module failure before minimal copied-source implementation and full CI review.
12. This is an inert, trusted-input-only helper: operational product edits need the M02 versioned schema, M03 atomic repository, M04 authorization and subsequent full D1/TDD/owner review.

## Impact and acceptance

- New internal export: normalizeProductPriceProfile_(stockUnit, conversions, payload).
- New files: src/modules/m05-product-unit-price-profile.js and tests/m05-product-unit-price-profile.test.mjs, plus this plan.
- Price anchors, source exact-price snapshots, nonanchor overrides, legacy single-unit fallback, invalid price/unit errors and no source mutation.
- No SQL, Worker/RPC, UI, M02/M03/M04 code, live Sheets, production data or any Cash/Bank/Party/stock mutation.
- No business writes and no migrations: rollback by reverting these three new files.
- PR must stay unmerged until GitHub source-preservation, Node, Workerd/D1, browser/preview checks are green, and owner review completes.
