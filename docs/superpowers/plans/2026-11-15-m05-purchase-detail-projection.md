# M05 — source-faithful purchase-detail read model (2026-11-15)

**Objective:** After merged M05 #75 FIFO planner, #87 purchase preflight and #90 local D1 purchase atomicity proof, port the *read-only detail display* of frozen `legacy/source/PurchaseManagement.gs::getPurchaseDetail`, without enabling the public API. Source truth is `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

**Repository gates:** Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007. GitHub-first; M05 helper owner only, M03 shared D1/posting and M04 auth/RPC owners unchanged. No UI redesign, no source mutation, no production D1.

## Acceptance and TDD

1. **RED:** new Node test executes the original `getPurchaseDetail` declaration from pinned `PurchaseManagement.gs` in an isolated VM as an oracle with controlled snapshots. The test imports a currently absent pure projector; GitHub CI must fail for that expected reason. Add a real local Workerd/D1 integration proof using the **existing M05 synthetic schema and poster**, verifying readback and no financial mutation.
2. **GREEN:** single pure `src/modules/purchase-detail-projection.js` with explicit already-authorized source-shaped snapshots. Result matches original for uniquely identified active purchases: source Supplier ID and name, purchase/date, subtotal/discount, grand/paid/due, payment method/bank name, notes/actor, active return aggregation and net purchase, product line quantities and selling-price fallback from purchase lot then product, and optional separately settled Supplier amounts. Cross-Purchase rows never contaminate projection.
3. **Fail closed:** missing/soft-deleted purchase use original error messages. Unlike source's `findFirstRow_`, ambiguous duplicate Purchase IDs must be rejected rather than selecting the wrong financial evidence. Flag this safety hardening explicitly; duplicates need M02 migration repair and owner review.
4. **RETEST:** validate actual Node/Workerd D1 integration, full GitHub CI, no D1 writes or binding changes, and retain source bytes. Do not merge on RED or pending CI.

## File/RPC/table inventory

- Add `src/modules/purchase-detail-projection.js` (pure internal read model).
- Add `tests/m05-purchase-detail-parity.test.mjs` (source-extracted VM oracle + no-write invariants).
- Extend `tests/integration/m05-purchase-posting-workerd.spec.mjs` with an isolated synthetic D1-to-source readback assertion. No new D1 fixture, migration or table.
- This Superpowers plan. `src/db/**`, `src/rpc/**`, `src/index.js`, `migrations/**`, `legacy/**`, UI and Wrangler deployment remain unchanged.

## Explicit limitations

- Supplier settlement values are provided as a **trusted already-resolved snapshot**; no ledger settlement/auto netting or permission inference. This pure helper cannot authorize/validate a client's read; future M04 RPC must get tenant and actor from authenticated session and M03 must bind/verify source links and unique purchase identity in D1.
- Historical duplicate source purchase IDs fail closed pending reconciliation, rather than silently changing accounts. No create/update/delete, editability or return posting is implemented.
- No production money, stock, bank, cash or Party write. `PARALLEL-MODULE-READY=false`. Roll back by reverting only the four changed files.
