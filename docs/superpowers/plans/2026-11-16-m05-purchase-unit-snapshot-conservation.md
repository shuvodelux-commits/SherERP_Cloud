# M05 — Purchase Unit Snapshot Conservation (READ-ONLY)

Date: 2026-11-16. Workstream: M05. Branch: `m05/purchase-unit-snapshot-conservation-20261116`.

## Implementation overview — 12 sentences
1. This step follows merged M05 PRs #313 and #408, which provide the approved multi-unit conversion and purchase/payment preflight without an active D1 purchase writer.
2. The frozen Mohim_ERP source remains authoritative for Purchase, stock lots and cash/supplier accounting, and the separately approved sherERP_Mohim unit-conversion source is authoritative for mixed-unit quantity and purchase-pricing snapshots.
3. The existing source-adapted `resolveProductUnitBreakdown_` produces the component unit, factor and entered-quantity snapshot as well as normalized stock-unit quantity.
4. The existing `computeUnitBreakdownPurchasePricing_` produces a component unit-price snapshot, its two-decimal line total and an intentionally unrounded base-stock-unit cost.
5. A future purchase importer or posting boundary must not silently reinterpret historical snapshots using the current Product Unit Conversion table because factor and price settings can change later.
6. This increment adds an internal pure `auditMultiUnitPurchaseSnapshot(preflight)` to check the already-validated candidate's quantity and amount conservation without looking up today's conversion catalog.
7. For each unit-based line, it checks component IDs, names, factor/quantity pairing, duplicate IDs, finite positive quantities and factors, and nonnegative unit prices.
8. It verifies that the sum of component quantities multiplied by their captured factors equals the line's base stock quantity within the source 0.0000001 numeric tolerance.
9. It verifies source two-decimal component-price rounding, and that line base-unit cost times base quantity equals the captured component line total.
10. It verifies overall purchase subtotal from normalized mixed-unit line totals and legacy single-unit lines without duplicating payment authorization or supplier-ledger logic.
11. Malformed or accessor-bearing snapshots are refused and unresolved arithmetic or identity discrepancies return explicit review issues; valid legacy single-unit lines retain their original behavior.
12. The helper has no SQL, live import, Cash Session bypass, public RPC, stock/Party mutations or preview D1 binding, and its RED then GREEN test evidence must be inspected on GitHub before any merge.

## Boundaries and acceptance
- New API: `auditMultiUnitPurchaseSnapshot(preflight) -> {ready,issues,summary}`, taking **only a trusted server-created preflight result**, never browser-authored snapshots.
- Source contract: approved `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` conversion functions, merged M05 code; frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` purchase subtotal.
- Tolerances: numeric factor/quantity/cost parity 0.0000001, subtotal 0.004 BDT; for component line total use the existing source roundMoney algorithm `Math.round((n + Number.EPSILON)*100)/100`.
- Unit snapshots must remain historical evidence and never consult current or changed Product Unit conversion settings. No migration of historical records from the original frozen source is inferred from the presence of optional multi-unit feature snapshots.
- The audit cannot prove snapshot provenance or authorize posting. The later M02/M03 owner must acquire tenant-scoped committed records, immutable source ID/profile links, SQL CAS, journal, stock-lot and unit-snapshot durability in one atomic exact-once boundary.
- Three new paths only: this plan, `tests/m05-purchase-unit-snapshot-conservation.test.mjs`, `src/modules/m05-purchase-unit-snapshot-conservation.js`. Existing M02 #413 and other workstreams are untouched.
- RED: test-only commit, failing in GitHub Actions because the module is intentionally absent. GREEN: smallest pure implementation, then exact-head Node, isolated Workerd/D1, Chromium, frozen-source byte, preview CI. Do not merge on queued/failed CI.
- No original GAS/Sheets modification, D1 schema, `src/db/**`, `migrations/**`, shared M03 writer, `src/rpc/**`, `src/index.js`, frontend, Cloudflare config, production credentials or online DB access. Rollback: revert three files, with no data effects.
