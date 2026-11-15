# M05 — Source-shaped purchase preflight (2026-11-15)

**Objective:** Port only the pure, no-write line/supplier validation and amount calculation performed before the WRITE PHASE of pinned `legacy/source/Purchase.gs::createPurchase`. This is an internal prerequisite, **not** a running purchase RPC or a D1 writer.

## Source and ownership

- Pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Purchase.gs` blob `4fe2ec112384153a0c88a625c7f22cd11df2a758`, plus `Bundles.gs` and `Utils.gs`.
- Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, and ADR-007.
- One new `src/modules/purchase-preflight.js`, one `tests/m05-purchase-preflight.test.mjs`, this plan. No changes to original code, `src/db/**`, migrations, `src/rpc/**`, public Worker, auth, Cash Session, Party, or deployment.
- Caller supplies an already-authorized, source-shaped snapshot. This helper does **not** claim snapshot freshness, permission verification or SQL atomicity.

## Superpowers test-first sequence

1. **RED:** Commit an executable `node:test` suite importing a not-yet-created module. It must fail with `ERR_MODULE_NOT_FOUND`. Cover supplier identity/status, individual quantity/cost/selling price validation, duplicate products, missing/deleted/bundle products, stock arithmetic, discount/payment clamping, due status, immutability, and no-write boundaries.
2. **GREEN:** Add the smallest pure implementation matching the frozen original purchase validation branch and error messages. Do not add extra financial state, database adapters or speculative abstractions.
3. **REFACTOR:** Only simplify if warranted while keeping source semantics.
4. **RETEST:** Run targeted Node tests, `npm test`, source checksum audit, frontend build, and relevant CI; document precise RED/GREEN evidence on PR. No real D1 test is claimed for this pure helper.

## Data, API and rollback boundaries

- No HTTP/RPC changes. Inputs: `payload`, explicit `products` and `suppliers` arrays of frozen GAS-shaped rows. Return an internal read-only proposed set of lines and totals, not a commit instruction.
- `Current Stock` remains an **untrusted snapshot**; `newStock` is advisory only. The future M03/M05 stock kernel must recheck source IDs, row versions, supplier/Party mapping, cash/bank account eligibility, active Cash Session, historical date and actor inside reviewed authorization/atomic SQL boundary.
- The original `createPurchase` uses JS numeric amounts. BDT exact-money/rounding parity and valid guard ranges must be separately designed before real D1 purchase posting.
- No source import, bank transfer, supplier balance, stock, Cash/Bank Book or journal write. Rollback is reverting this branch; no data migration.
- **PARALLEL-MODULE-READY remains false**. Live M05 needs M02/M03/M04 gates, ID/counter review, full FIFO/OVERSOLD/vendor/bundle requirements, purchase edit/delete, replay/rollback/concurrency evidence on real D1, and end-to-end browser tests.
