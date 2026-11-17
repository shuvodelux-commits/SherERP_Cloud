# M05 — Tiles Carton→Box→Pcs stock display follow-up

**Issue:** #577 · **Parent:** merged PR #566 · **M01 UI:** #564 / draft PR #581 · **M03 single writer:** #22 · **board:** #456.

## Twelve-sentence implementation overview

1. Product Add and Stock table needs the same quantity source to support an outer Carton above Box and Pcs for Tiles.
2. The original merged M05 Product form preview correctly handled Box→Pcs and exact Tiles Sqft but rejected any additional active upper tier.
3. The extra rejection was introduced by a front-door single-tier length check, not by the reviewed Tiles pack identity contract.
4. An additional Carton→Box tier does not change the physical Pcs-per-Box ratio or the dimension-to-Sqft mapping.
5. The test-first regression includes a valid chain of one Carton equal to ten Boxes and one Box equal to twenty-five Pcs.
6. Two Cartons plus five Boxes plus three Pcs must produce exactly six hundred twenty-eight physical Pcs.
7. For twenty-four-inch square tiles, those pieces represent 2,512.00 nominal Sqft.
8. A second test requires the negative 628-Pcs state to appear as a shortage rather than sellable inventory.
9. The RED test-only SHA `ecf61e6ab18031aa822d3b84391f571460b842e7` failed both new tests while existing fifteen passed, proving the rejection.
10. The GREEN SHA `b523e1e907739db33c5f1f85e1ce41bbffdea68a` removes only the unnecessary upper-tier prohibition while retaining the unique Box, exact pack factor, Product ID and measurement revision checks.
11. All seventeen targeted Node tests passed on the exact GREEN branch in a temporary checkout, without editing the original HTML, D1, RPC, posting or account code.
12. Full current-head GitHub CI and human review are required before merge, and the future M01 Products UI must not describe this read-only preview as authorized Product Save.

**File ownership:** M05 exclusively: `src/modules/m05-product-form-stock-preview.js`, `tests/m05-product-form-stock-preview.test.mjs` and this new plan. No shared infrastructure or source data edits. Production transaction writes remain BLOCKED under `docs/M03_PARALLEL_READINESS.md`.

**Roll back:** revert the two focused code/test changes; no data or schema rollback. **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, approved optional `sherERP_Mohim@590adfad128fe7155bfb7b6085b202a9c`.
