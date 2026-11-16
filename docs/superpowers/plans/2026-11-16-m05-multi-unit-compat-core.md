# M05/M06 — Multi-unit product quantity and pricing compatibility core (2026-11-16)

**Canonical business source:** `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains authoritative for existing bundle/FIFO/party/sales/purchase logic. **Supplementary requested feature source:** `shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c` from merged [PR #27](https://github.com/shuvodelux-commits/sherERP_Mohim/pull/27), [#30](https://github.com/shuvodelux-commits/sherERP_Mohim/pull/30), [#38](https://github.com/shuvodelux-commits/sherERP_Mohim/pull/38), [#39](https://github.com/shuvodelux-commits/sherERP_Mohim/pull/39). The three currently open `Mohim_ERP` PRs #48/#41/#30 do **not** implement this feature. A partial Hono/Vue reference also exists at [BanijjIQ draft #4](https://github.com/shoaibadmi-sec/BanijjIQ/pull/4), **not release-ready**.

## Thirteen-sentence module overview

1. Current authoritative Mohim_ERP persists one product stock unit and does not contain multi-unit conversion configuration.
2. The earlier approved sherERP_Mohim work provides the requested natural unit chain, price-unit configuration and historical unit snapshots.
3. This PR ports the **pure business calculation contract** into the Cloudflare ERP rather than copying old Google Sheets writes or changing the UI.
4. A natural chain such as 1 Bag = 5 Box and 1 Box = 20 Pcs must derive 1 Bag = 100 Pcs and one canonical stock unit.
5. A mixed cart entry such as 1 Bag + 2 Box + 5 Pcs must normalize into 145 Pcs and one deterministic ordered snapshot.
6. A chain may only use approved active units and must reject broken connections, repeated/circular units, nonpositive factors and impossible quantities.
7. A missing conversion breakdown for an existing product preserves its current single-unit behavior.
8. The client cannot choose an arbitrary factor, historical conversion ID, inactive row or claimed base total to change inventory consumption.
9. Each purchase conversion may carry a distinct purchase-price override without changing the canonical stock quantity.
10. Each sale conversion may carry a distinct selling-price override while otherwise consuming the current trusted FIFO price ladder.
11. The exact component line total remains authoritative when an effective base-unit price requires rounding.
12. Full D1 product master, purchase/sale item snapshot persistence, authorized posting, rollback, returns and original UI integration are **future dependent slices** behind M02/M04/M05/M06/M07 gates.
13. No original GAS source, production Sheets/D1, public RPC, Preview binding, migration SQL or traffic is modified by this preparatory, locally testable logic.

## Integration constraints

- **Change inventory:** `src/modules/product-unit-conversions.js` source-adapted pure calculations; `tests/m05-multi-unit-contract.test.mjs` compatibility and rejection coverage; this plan. No alterations to existing `src/modules/stock-fifo-planning.js` or purchase/sale posting yet.
- **Prerequisites for later product master:** Review a versioned M02 `PRODUCTS` table and product-specific conversion table, source-ID preservation, chain/price-unit metadata, keys/uniqueness, management permission, SQL guard and migration rehearsal.
- **Prerequisites for live M05/M06/M07:** Server must load trusted conversion rows, recompute base quantity and item revenue/cost, write immutable breakdown and price snapshots in the **same** guarded D1 transaction as lots, inventory, ledgers and payment; edits/returns must use frozen historical factors rather than current settings.
- **Validation:** RED first under GitHub Actions, then GREEN Node regressions; no mock-only tests will be claimed as proof of real D1 posting.
- **Safety:** Keep all public RPC operations disabled until separately approved M04 authorization; no live database export or deployment.
