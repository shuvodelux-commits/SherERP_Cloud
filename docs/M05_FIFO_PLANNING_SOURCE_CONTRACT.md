# M05 — Source-faithful FIFO planning and lot price ladder

**Status:** Internal, read-only, non-posting functions. This does **not** ship M05 inventory or unlock M06 sales.

## Source

Pinned immutable `Mohim_ERP/main@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, copied `legacy/source/StockLots.gs` and `legacy/source/Utils.gs`. Nine original function declarations have **byte-for-byte identical function bodies** in `src/modules/stock-fifo-planning.js` (verified by `acorn` AST spans, no source edits):

- `compareLotsFifo_`: earliest **Purchase Date**, not Created At (fallback if Purchase Date missing); then Lot ID lexicographically.
- `lotSellPrice_` and `buildLotPricingLadder_`: lot Sell Price, fallback product Selling Price, merge adjacent identical prices. Ladder excludes `Status==='Deleted'` and nonpositive lots.
- `planStockConsumption_`: read-only per-lot drawing; mixed supplier lots sorted FIFO; outputs `draws`, `remainingAfter`, `unitCost`, `unitSellPrice`, and `shortfall` without creating an OVERSOLD row or editing stock.
- `planSaleVendorConsumption_`: vendor shortage determined by **net** Products.Current Stock, not sum of positive lots, because historical OVERSOLD debt may coexist with positive lots. No vendor journal or payment is created.
- `computePlanSellingPrice_`: source `roundMoney_` rounding of weighted line total and display unit price.
- `Utils.gs` helpers `safeDateOnly_`, `isValidNonNegativeNumber_`, `roundMoney_` are copied without edits.

The small `formatDate_` implementation in this module uses deterministic `Asia/Dhaka` date conversion for the original default business timezone; timezone-configurable lot date parity remains a later integration requirement. Hidden `getAllRows_` calls deliberately throw. The caller **must** supply already reviewed `allLots` and `productRow` snapshots—no global Sheets or D1 fallback.

## Test evidence

`tests/m05-fifo-planning.test.mjs` independently extracts and executes the nine functions **from the frozen original GAS source** in an isolated JS VM and compares results to the port on synthetic data. Assertions cover purchase-date FIFO and tie order, legacy Created At fallback and Bangladesh timezone boundary, mixed-supplier lot costs and physical row references, no mutations, positive shortfall with fallback prices, pricing ladder price-step merging, missing Sell Price/explicit zero price, exact 2-decimal line price, vendor sourcing with net-owned shortages and negative Current Stock, empty plans, hidden GAS reads rejected, and the Deleted-lot discrepancy below.

## Safety blocker: Deleted positive lots

The original `planStockConsumption_` filters by product and positive Remaining Quantity, **but does not filter `Status==='Deleted'`**. The original `buildLotPricingLadder_` *does* filter Deleted lots. This port preserves the original planners exactly and **documents the inconsistency rather than quietly changing business behavior**.

**Do not call this port from a production stock mutation or enable it in POS** until the M05 owner decides a source-faithful remedy and proves the same lot eligibility consistently in planning, pricing, D1 write CAS predicates, source reconciliations and sale return restoration. The test contains a deliberate regression case demonstrating the discrepancy. D1 business transactions must not trust nontransactional `Remaining Quantity` snapshots.

## Still blocked

No D1 `STOCK_LOTS` schema or purchase importer, supplier Party legacy-link resolution, atomic lot CAS / journal / reconciliation, OVERSOLD debt clearing, vendor consignment, bundles, partial purchase return or sale-return lot restoration, auth or tenant enforcement. No RPC registration, Cloudflare preview D1 binding, real staff/customer data, financial posting or source file edits. Source parity of planning is **not evidence of safe transactional execution**.
