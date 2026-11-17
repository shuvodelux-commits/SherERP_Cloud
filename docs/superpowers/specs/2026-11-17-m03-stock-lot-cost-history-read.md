# M03 — Private stock lot cost correction history D1 reader

**Date:** 2026-11-17
**Workstream / owner:** M03 shared D1 integrator; issue #22, coordination #456
**Base main:** `1cd270e29e7a023f1a84c784e31845a9927704c4`
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`
**Existing prerequisite:** M02 migration `0011_legacy_stock_lot_cost_corrections.sql`, importer and mapping already in main.

## Why

Frozen `Config.gs::HEADERS.STOCK_LOT_COST_CORRECTIONS` has 16 original columns. `StockLots.gs` appends the correction to immutable source history when an authorized stock-lot cost adjustment changes prior COGS and invoice profit context. Existing M02 `legacy_stock_lot_cost_corrections` stores the archival snapshot in TEXT, including original financial signs and number spelling, with immutable UPDATE/DELETE triggers. **It is history only**, not a live cost-correction or journal engine. There is no reviewed private M03 read adapter for this group in current main.

## Choices

- Reuse active M05 stock/COGS adjustment: rejected because an archived audit must never mutate valuation or infer current stock.
- Enable generic public `getAllRows_`: rejected because the full source-shaped authenticated RPC, source/Party reconciliation and live posting gates remain blocked.
- **Selected:** one private, bounded, fixed-table D1 read adapter analogous to recent historical M03 audit readers. No new generic shared helper, schema, RPC, public Worker, posting kernel or remote D1 connection.

## Interface

`createStockLotCostAuditReadAdapter(env)` requires `env.DB` via `requireD1Binding` and exposes only six original awaited read helpers: `getSheetHeaders_`, `getAllRows_`, `findRows_`, `findFirstRow_`, `findRow_`, `findRowIndex_`.

The only Sheet key accepted is `STOCK_LOT_COST_CORRECTIONS`. The only lookup fields accepted are the exact 16 frozen source headers; unknown and SQL-like headers are rejected **before** touching D1. The fixed SELECT reads `legacy_sheet_row` plus 16 mapped columns from `legacy_stock_lot_cost_corrections`, ordered by physical original source index, with a bound `LIMIT 1001`. It returns at most 1000 rows, never a truncated ledger.

Each returned D1 row must have exactly 17 own enumerable data keys. Reject getters, symbols, extra private columns, missing keys, unsafe/gapped physical indexes, duplicate or empty Correction IDs, empty Lot IDs/Product IDs, nontext fields and invalid result envelopes. Historical `'-0.00'`, `'-17.250'`, `'0'`, `'12.00'`, blank values, UTF-8 actor names, whitespace Reason, repeated Lot IDs and repeated Product IDs are preserved **as raw archive text**. Findings use original `String(row[field])===String(value)`, not numeric equality. Each lookup is awaited, reads a fresh bounded snapshot and returns original source row position. Reject invalid D1 replies with generic errors; never leak SQL, historical actor identity, products, prices or notes.

## Tests and gates

Node regression is committed first, and GitHub Foundation RED must demonstrate expected `ERR_MODULE_NOT_FOUND`. GREEN is the smallest M03-only reader implementation. A private real local Workerd/D1 test imports synthetic source history through the existing M02 importer and verifies source-shaped read, immutable triggers, repeated lot corrections, archive gap denial and public RPC closure. A standalone PR-only workflow with the project's required per-PR cancellation and npm cache is added without changing the shared six-shard CI. M11 CI owner review is requested.

No migration edits, no Cash/Bank, POS/Sales, purchase lot, invoice/COGS recomputation, public RPC, auth change or production deployment. M03 shared transaction readiness remains **BLOCKED** even when this archive reader passes.
