# M06 POS V2 — unified standard/multi-unit/Tiles cart preview (safe integration slice)

**Owner-approved request:** Connect POS V2 to multi-unit selling, Tiles, and eventual D1 sales posting.  
**Module lane:** M06. **Issue:** #314 (unfinished requirements despite its closed GitHub state). **Coordination:** #456; M03 single integrator #22 and M01 frontend #25.  
**Base:** `main@59b0e2e4b7184acf2f3645aca32da1cb1c6d5cb3`.  
**Frozen business source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; approved supplementary multi-unit source `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.  
**Owned files:** `src/modules/m06-posv2-unified-cart-preview.js`, `tests/m06-posv2-unified-cart-preview.test.mjs`, this plan.  
**Exclusive shared files not changed:** `legacy/source/pos.html`, `legacy/source/posv2.html`, `src/db/**`, `src/rpc/**`, migrations, `src/index.js`, Worker config, `scripts/build-frontend.mjs`, M01 Playwright setup, M05 pricing/stock modules.

## Important limitation

`docs/PARALLEL_EXECUTION.md` + `docs/M03_PARALLEL_READINESS.md` explicitly block transaction-module public writers. `src/rpc/registry.js` remains intentionally empty and M03 posting handoff v0.1 is review-only. This independently reviewable M06 work is a **non-deployable, private, read-only composition** that M01 and M03 can later consume once reviewed contracts/authority exist; it does **not** activate sales, touch the live frontend, mutate D1 or claim release readiness.

## Implementation contract

Export `previewPosV2UnifiedCartCandidateD1(intent, snapshot)`:
- Intent contains exactly `lines,discount,payments`; each line selects either `kind:'Standard'` with `productId,claimedBaseQty,shortageMode,unitBreakdown`, or `kind:'Tile'` with `productId,request`. Treat values as *quantities only*, never as actor, revision, price, factor or cashier authorization.
- Trusted snapshot contains `products,conversionRows,stockLots,bankAccounts` and private `DB` if any Tile exists. The future M04-authorized M03 caller, not the browser, is responsible for retrieving and rechecking tenant-scoped records.
- Reuse existing `planMultiUnitPosLine` (source FIFO + multi-unit price and shortage choice) and `previewTileSaleLineCandidateD1` (current M03 measurement + exact rational Sqft pricing) without copying their math or SQL.
- Enforce exactly one logical line per Product ID **across product types**. Validate plain data/no accessors and allowlist every inbound intent field; reject undefined/unknown/deleted/bundle items through the existing planners. Forbid quantities with ambiguous browser-provided unit-price/factor/revision overrides.
- Sum every checked quoted line in integer paisa, apply original source discount clamp, run the existing `normalizeSalePayments_` one time for the entire mixed checkout. Do not infer a Party/customer from names or phones, and do not net Customer and Supplier accounts.
- Return **display-only** line projections: productId/kind/productName, quantityLabel, canonical base stock quantity/unit, immutable quote snapshot (unit factors/price components or Tile original measurement/area/price/revision), exact lineAmountMinor + lineTotal; subtotal, discount, grandTotal, applied/due/change and the original payment allocation. Do not return raw D1 source rows, FIFO lot IDs, purchase costs, secrets, actor or session IDs.
- Always set `postingAllowed:false` and `stockAuthority:'not-loaded'` in the top-level result and each row. No direct invoice generation, draft save, stock reservation or financial writes.

## Superpowers RED→GREEN

1. **RED**: add the independently runnable M06 acceptance test before the implementation file. Assert one Standard multi-unit line (1 Bag+2 Box+5 Pcs), one nominal Tile line (2 Carton+3 Pcs and 35.33 Sqft), exact component totals, combined split tender, Cash change, frozen snapshots and no raw price/lot/cost leak. Include ordinary single-unit compatibility, duplicate ID across kinds, fabricated pricing fields, invalid payment/discount, malicious getter, missing Tile D1 binding, invalid product and revision checks.
2. Record expected test failure via GitHub CI against the test-only head.
3. **GREEN**: implement minimal M06-owned async composition, reuse existing M05/M06 and M03 private read-only functions. Do not extend public RPC or original UI.
4. Run affected Node tests, original source hash/build, all six local Workerd D1 shards and browser checks through exact-head required GitHub CI; document verified statuses and original-source parity.
5. Open one PR to main with exact SHA and 0 shared-file edits; leave merge for full CI and owner review.
6. Hand off M01 DOM controller binding and M03 authenticated atomic writer as **separate coordinated PRs**, not hidden in this PR.

## Expected acceptance totals (synthetic only)

- Standard `1 Bag+2 Box+5 Pcs=145 Pcs`, source component line total 1340.00 BDT, not rounded displayed `baseQty × unitPrice`.
- Tile `2 Carton+3 Pcs=53 Pcs=35.33 displayed Sqft`, exact nominal money 1342.67 BDT.
- Combined `subtotal=2682.67`; `discount=42.67`; `grandTotal=2640.00`; Bank 500 + Mobile 300 + Cash tender 2000 → applied Cash 1840 and change 160.00.
- Zero mutation in D1, source arrays or UI. Error paths fail closed.

**Risk and rollback:** Only an internal unused adapter plus isolated tests/docs. Revert the PR; original POS behavior/preview builds remain unaffected. Real checkout stays blocked by M03+M04+M05+M01 acceptance gate.
