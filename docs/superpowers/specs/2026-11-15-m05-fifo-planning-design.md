# M05 — pure source-faithful stock-lot FIFO / POS price planning

Pinned GAS: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `legacy/source/StockLots.gs` and `Utils.gs`. Scope: **planning-only**, internal and no writes.

Port, preserving function bodies byte-for-byte from frozen GAS:
- `compareLotsFifo_`: Purchase Date ascending (not write time), Created At fallback, zero-padded Lot ID lexicographic tie-break.
- `lotSellPrice_`, `buildLotPricingLadder_`: per-lot selling price with current product fallback, adjacent equal-price merges, Deleted lot filtered by ladder.
- `planStockConsumption_`: mixed supplier lot FIFO; per-lot draw/cost/sell price; shortfall reported but **no OVERSOLD lot creation** until M05/M06 atomic posting.
- `planSaleVendorConsumption_`: vendor shortage based on **net owned Product.Current Stock** rather than gross positive lots; no stock write.
- `computePlanSellingPrice_`: two-decimal line total and display unit price.

Include source `Utils.gs` date/number/rounding helper bodies unchanged, with small server-side formatting adapter pinned to `Asia/Dhaka` (default original shop timezone). No SpreadsheetApp, hidden reads, mutable globals or RPC. An attempt to omit explicit allLots/productRow should fail before any GAS fallback.

Source parity via AST exact bodies + executing pinned source functions in isolated Node VM against the port on synthetic fixtures. Separate tests for purchase date vs Created At, Lot ID tie, multi-supplier plan, unit sell fallback, money rounding, vendor sourcing when historical OVERSOLD debt reduces net own stock, zero/overdraw, no input mutation. Source historical issue: StockLots `planStockConsumption_` filters available positive lots but does not filter `Status==='Deleted'` while `buildLotPricingLadder_` does; document and do not authorize production stock writes until owner-approved deleted-lot invariant is settled.

This is **not** real M05 D1 lot repository or transactional posting; no schema/staging writes, role/tenant permission, bank/cash, inventory mutation, stock adjustment or public route. M05/M06 real D1 transactional concurrency, idempotency, vendor/consignment, purchase returns and role authorization remain blocked.
