# M05 — Multi-unit purchase preflight composition (2026-11-16)

**Base dependency:** stacked on [M05/M06 multi-unit core PR #313](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/313), head `1fc20bc84cd5e84750a47b112078169cc5c33bd8`. Retarget to main only after #313 is reviewed and merged. Baseline source for original purchase validation is `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; supplementary approved unit source is `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Thirteen-sentence module overview

1. Existing SherERP purchase preflight validates supplier, product, quantity, cost, sell price and source gross balance without writing to a database.
2. PR #313 supplies the approved pure unit-chain and authoritative unit purchase-pricing functions from the earlier sherERP_Mohim implementation.
3. This increment composes those two reviewed helpers, not a new financial calculation engine or a second purchase posting path.
4. The caller provides explicit trusted product, supplier and product-specific conversion snapshots without implicit Sheets or D1 reads.
5. A mixed input of 1 Bag, 2 Box and 5 Pcs should generate a single purchase line with 145 base Pcs and frozen unit breakdown provenance.
6. The chosen product's active trusted conversion catalog, not browser factor or unit-price fields, determines quantity and price.
7. Source purchase price overrides can differ from selling price overrides, and the result retains an exact two-decimal component line amount.
8. The existing source-shaped purchase preflight still checks supplier, deleted products, forbidden bundles, duplicate items, discount, payment and balance.
9. A line with no unit breakdown preserves the original single-unit preflight response and its editable purchase price.
10. Invalid quantity claims, duplicate/inactive/foreign conversion IDs or malformed breakdowns fail before producing a purchase preview.
11. The returned conversion snapshots and every source product/supplier/line input remain unchanged by previewing.
12. Tests must fail first for the missing new module on a GitHub RED commit, then pass with the smallest GREEN module plus full repository checks.
13. This read-only preview must never register public RPC, mutate stock or post Cash/Bank/Supplier due, and final release still requires M02/M03/M04 shared SQL atomicity, idempotency and M07 historical reversal evidence.

## File and contract impact

- New `src/modules/m05-multi-unit-purchase-preflight.js`: internal pure adaptation only.
- New `tests/m05-multi-unit-purchase-preflight.test.mjs`: read-only source and regression parity tests.
- This plan only. Existing `purchase-preflight.js`, `product-unit-conversions.js`, frozen GAS source, front-end, auth, `src/db`, `src/rpc`, migrations and deployment remain unchanged.
- Input: source-shaped `payload` and explicit `{products,suppliers,conversionRows}` snapshots.
- Output: same source purchase preflight result plus `line.unit` only for mixed-unit lines, with `stockUnit`, `unitSnapshot`, `pricingSnapshot`, and `lineTotal`.
- No D1 table, SQL trigger, operation ID, journal, API endpoint or remote migration.
- Rollback: revert the three new files. No database data or accounting corrections involved.

## Superpowers RED → GREEN → review

1. Commit plan.
2. Commit tests against a deliberately missing module; prove GitHub Actions Node suite fails with `ERR_MODULE_NOT_FOUND` specifically for M05 tests.
3. Implement minimal module importing PR #313 helpers and existing purchase preflight, with no changes to source function bodies.
4. Verify full `npm test`, immutable source, build, all exact-head CI and isolated Cloudflare preview.
5. Keep a **draft stacked PR** targeting the #313 branch until the dependency merges and checks are re-run against main. No live financial feature enabled.
