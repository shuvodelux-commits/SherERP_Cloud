# M09 Stock Report legacy Product ID integrity — design

**Source:** frozen `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Reports.gs::getStockReport`, `Config.gs::PRODUCTS/STOCK_LOTS`. **Workstream:** M09 in `docs/WORKSTREAMS.md`.

## Problem

The existing internal `projectStockReport` converts missing/blank/primitive non-string `Product ID` cells to string keys (`undefined`, `null`, `0`), potentially reporting a phantom stock identity or attributing an unlinked lot. The original GAS function does not guard source-corrupt IDs; the D1 port must **fail closed** rather than assert monetary report parity on corrupt inputs.

## Chosen approach and alternatives

Minimal validation in the existing private Stock Report projector. Require each Product and Stock Lot's own `Product ID` to be a **nonempty string with at least one non-whitespace character**. Preserve its exact bytes for grouping; do not trim/rename source IDs. Do not change the original report's positive-lot-only stock valuation, inactive-product handling, aggregate totals, mismatch logic, source ordering or orphan-lot treatment. Alternative of changing D1 tables/imports or dropping invalid rows silently is rejected: it changes a shared schema and could hide financial discrepancies. Alternative of adding an RPC is rejected until all M02/M03/M04/M08 integration gates pass.

## Acceptance

1. Missing, undefined, null, empty, whitespace, numeric, boolean, object and symbol IDs fail closed before a misleading report is returned.
2. Valid source IDs still produce unchanged source-compatible totals including negative/zero/orphan lots.
3. Neither original GAS/Sheets nor public Worker, auth, D1 schema, posting, report screen, or Cloudflare config is changed.
4. Superpowers RED → GREEN evidence from actual GitHub CI and full Node regression suite; owner reviews PR before merge.
