# M06-B16 — historical Tiles checkout evidence audit (internal, read-only)

Workstream M06; issue #314; parallel coordination #456. Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 (SalePayments.gs) and approved multi-unit reference sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c. Starting main SHA: 07baf6038b2c56ebdc1292585712630f5e4b2516.

## Overview (12 sentences)

M06 has merged private multi-Tile Box/Pcs/Sqft checkout and exact source split tenders. The result is a read-only quote, not a stock reservation or D1 sale posting. We need a separate review boundary to detect altered or incomplete checkout evidence before handing it to downstream design work. A pure audit will re-evaluate the **captured historical** Tile measurement and price snapshot with the existing exact rational quantity/pricing contract. It will compare physical pieces, Box breakdown, rational Sqft, billing quantity and exact line paisa without multiplying rounded displayed Sqft. It will keep separate logical Product IDs and reject cross-product or revision substitution. It will verify subtotal, discount clamp and Grand with safe integer-paisa arithmetic. It will verify original Cash/Bank/Mobile applied tender, returned change, Paid/Due and source payment header semantics. It will report diagnostics only and cannot convert a quote into authorized posting. The audit will neither load current product revisions nor modify existing POS, D1, Cash Session, RPC or UI files. Tests will cover valid read-only source-shaped output, corrupted source snapshots, duplicated keys, overflows, forged posting claims and tampered payments. Full GitHub current-head CI and module-owner review are mandatory before merge.

## Exact file ownership

- New only: `tests/m06-tile-checkout-evidence-audit.test.mjs` (RED first).
- New only: `src/modules/m06-tile-checkout-evidence-audit.js` (GREEN after RED).
- This plan: `docs/superpowers/plans/2026-11-17-m06-b16-tile-checkout-evidence-audit.md`.
- **Read/write:** pure read-only JS on caller-supplied preview; **zero** D1/SQL/production writes; zero RPC or deployment changes.
- **Protected/out-of-scope:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, shared posting, `wrangler*`, existing frontend, M05/M07/M08/M09 modules.

## Superpowers acceptance and evidence

1. RED: commit acceptance tests before the implementation exists; capture expected failing missing-module test in GitHub CI if possible. Never claim hosted RED unless a log confirms it.
2. GREEN: minimal pure `auditMultiTileSaleCheckoutEvidence(preview)` returns `{ready, issues, summary, postingAllowed:false}`. It reuses existing `priceTileQuantity` + `salePaymentPaisa_` and never reads the current catalog.
3. Run `node --test tests/m06-tile-checkout-evidence-audit.test.mjs`, `npm test`, full required GitHub/real local Workerd D1/browser CI; distinguish pure synthetic tests from D1 tests.
4. The result `ready:true` means **internal arithmetic evidence consistency only**, NOT source authenticity, tenant permission, loaded stock, Cash Session, Cash/Bank/Party posting or a deployable public Sale RPC.
5. Merge only after full latest-head required CI, owner review, conflict/ownership check, verified dependency integration. Rollback: revert the three new M06-owned files only.

## Blocking integration dependencies

M02 source ID/unit/Party evidence, M03 single SQL-atomic stock+ledger/Cash Session kernel, M04 server-verified tenant/actor, M05 stock/FIFO/shortage, M07 reversal, M08 role-distinct accounts, M09 invoice/print, M10 migration reconciliation and M11 cutover authorization. No production sale posting or public RPC is enabled.
