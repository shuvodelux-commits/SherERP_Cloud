# M03/M06 P0 — First operational original POS Cash sale

**Base:** GitHub main `5a18e1d5cbaf89c5ca65f69243e5af43db2b28c2`. **Scope reservation:** coordination #456. **Source:** pinned Mohim_ERP`@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `legacy/source/pos.html`, `Sales.gs`, `Invoice.gs`; existing operational credit Purchase #795 and M06 trusted default checkout #797. **Method:** /super build → /super qa → /super review. RED test → smallest GREEN → refactor → final GitHub CI.

## Outcome
The original Owner frontend posts exactly one current-price cash-only standard product against stock received by the operational Purchase in the same real Shop D1. SQL-atomic receipt creation, first eligible FIFO lot deduction, aggregate product stock deduction, and an immutable Cash Book row. Return a full snapshot invoice compatible with the original `posRenderInvoice_` and printer; same unchanged request/operation ID returns the same invoice. Never simulate a sale or borrow the M06 synthetic test fixture in the Worker. Remain explicitly opt-in (`OWNER_MVP_POS_CASH_ENABLED=true`) and completely private; no public RPC, no D1 in PR preview, no Cloudflare deployment in this PR.

## Exact file ownership
- Exclusive shared M03: `src/m03-owner-redemption-worker.js`, `scripts/build-owner-frontend.mjs`, `src/db/m03-owner-ready-shop-migrations.js`, `src/db/m03-owner-mvp-purchase.js` (only if needed to prevent cash-close misstatement).
- New: `src/db/m03-owner-mvp-cash-sale.js`, `staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql`, `tests/integration/m03-mvp-cash-sale-workerd.spec.mjs`, `qa/m03-mvp-cash-sale-browser.spec.mjs`, `.github/workflows/m03-mvp-cash-sale.yml`, this plan.
- No changes to original source, existing M05/M06 financial planning modules, public `src/index.js`, `src/rpc/**`, vendor, bank, imported data, or production bindings.

## Feature guard and negative behavior
One active Owner session, verified Shop identity, SQL-time write lease and open cash session required. One Standard product on one oldest eligible source Purchase FIFO lot with sufficient whole-unit quantity. Source `priceMode:'auto'`, original default `shortageResolution:'negative'` allowed **only if** enough real owned stock and the exact total from D1 equals visible unit price × quantity. Source `customerId:''` plus provided contact name/phone is a walk-in cash sale; no Party creation. Payment must be Cash, paid-in-full, discount=0; no split or credit. Reject vendor shortage, bundles, zero/negative/oversold, quantities spanning multiple lot prices, stale price, edited/draft sales, and unapproved bank/multi-unit/Tiles. This is not general POS feature parity.

The POST body is `{operationId,payload}`. The original single-payment POS does not provide a stable operation ID by itself: the private frontend wrapper must mint a UUID once per unchanged payload, reuse it after an uncertain network outcome, invalidate only after committed receipt, and avoid double posting on retry. SQL receipt uniqueness enforces exact once, and replay validates tenant/actor/hash. All payment, stock and invoice side effects are one committed SQLite statement/trigger transaction with SQL-time guards. A trigger-induced cash failure must roll back receipt and lot/stock. A Shop D1's first-sellable-lot shortfall is declined rather than taking the next lot without a reviewed multi-lot allocation.

## Tasks
- [ ] Create RED integration and source browser tests first; use original Shop D1 harness with 0005 Supplier + 0006 Purchase + proposed 0007 Sale.
- [ ] Observe actual GitHub RED for missing import/route before writing production code.
- [ ] Add append-only numbered 0007 testable migration: Sale receipt, one FIFO allocation, Cash Book, immutability constraints, SQL atomic AFTER INSERT posting and cash-close safety.
- [ ] Add exact-price, stock and authorized cash-sale writer and source-shaped secure POS bootstrap/invoice retrieval; replay must return immutable stored sale, even after stock or price changes.
- [ ] Add original frontend minimal mapping `getPosBootstrap` and `completeSale`, plus empty verified current-Shop draft list and persisted invoice retrieval. Preserve original HTML, cart and printer.
- [ ] Run real two-Shop Workerd/D1 positive/negative/concurrent/rollback and Chromium original POS + printed invoice smoke tests.
- [ ] Refresh Shop migration profile SHA-256 and related pin tests; run full GitHub matrix and independent M03/M06/M08 review.
- [ ] Leave draft PR if external Cloudflare Builds fails or independent accounting/release approvals missing; no remote writes or deployment.

## MVP continuation after this PR
M05 multi-lot/FIFO, Tiles and multi-units; M06 bank/partial/split payments; M07 original lot-based return/refund; M08 exact gross Cash/Bank/Party ledgers and reconciliation; M09 browser/print source parity; M10 restore; M11 release. Do not describe this constrained pilot as the complete ERP MVP.
