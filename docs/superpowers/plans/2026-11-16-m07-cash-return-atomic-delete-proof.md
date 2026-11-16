# M07-B2 — Source-linked Cash Return correction deletion: synthetic Workerd/D1 proof

**Frozen authority:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `SalesReturn.gs::prepareSalesReturnChange_`, `deleteSalesReturn`, `StockLots.gs::planSalesReturnStockUndo_`, `DeleteEngine.gs::isDeleted_`.
**Target:** SherERP Cloud current `main` + merged M07 Cash Return test-only receipt; see `docs/M07_RETURNS_SOURCE_CONTRACT.md`.
**Status:** non-deployable **synthetic** transaction-safety proof, *not* operational native return deletion.

## Overview (12 sentences)

1. A completed Sales Return must never be deleted by physically erasing its immutable receipt.
2. The original transaction's Cash refund, returned lot quantity and stock movement must be verified before any correction.
3. M07 must reject unknown, ambiguous or already corrected Return IDs instead of guessing source amounts.
4. The reversal must affect exactly the original purchase-linked sold lot and corresponding shop stock.
5. If a returned lot has been resold, a deletion cannot borrow remaining units from another lot.
6. A real D1 trigger must enforce the original stock and refund evidence within the same write transaction.
7. A deletion records an immutable correction receipt and inverse stock and Cash evidence without modifying the original posted record.
8. The synthetic active-return projection excludes corrected returns while retaining an audit trace.
9. A stable tenant-scoped operation ID, actor, reason and source fingerprint must yield one commit or a harmless identical replay.
10. A competing or changed request must not double-reverse Cash or inventory.
11. Failure injection at either inverse stock or Cash offset must roll back every correction effect in D1.
12. This proof is restricted to synthetic single-line Cash returns; actual historical-session authority, native multi-line/Bundle/Store Credit corrections and public RPC remain blocked on the shared M03/M04/M05/M06/M08 migration.

## Implementation ownership and interfaces

- `tests/fixtures/m07-cash-delete-schema.mjs` — extra **test-only** SQLite tables, guarded receipt trigger, read-only active projection. No production migration.
- `tests/fixtures/m07-cash-delete-contract.mjs` — `createSyntheticD1CashReturnDeleteContract(DB,{beforeBatch}?).post(input)`; accepts exact identifiers, original source hash, qty/amount and correction reason; returns `COMMITTED`, `REPLAY`, `CONFLICT` or `DECLINED`. SQL uncertainty -> `NEEDS_REVIEW` error.
- `tests/integration/m07-cash-delete-workerd.spec.mjs` — isolated Wrangler Workerd/D1 acceptance tests and failure-injection evidence; fixture data only.
- `wrangler.m07-cash-delete-test.jsonc` — new local-only D1 binding ID, no remote deployment.
- `tests/integration/m03-workerd.spec.mjs` — one import line so existing full real-D1 CI executes this suite.
- This plan is the sixth changed file.

No edits to `src/**`, `migrations/**`, `legacy/source/**`, original UI, `src/rpc/**`, Cloudflare deployment, staff/session implementation, Party master, shared posting kernel or existing M06/M07 fixture source. The correction receipt is **not** a generic correction engine or an authorized service method.

## Superpowers TDD execution

1. **RED:** add integration tests and test-owned schema/config, plus integration import, before adding the contract. The real Workerd D1 suite must fail specifically for absent `m07-cash-delete-contract.mjs`; record GitHub Actions evidence.
2. **GREEN:** minimal tenant-scoped SQL claim + receipt readback, immutable correction marker and guarded trigger. Verify duplicate/replay, concurrency, original row integrity, lot resold, session closed, separate Customer AR / Supplier AP and full rollback.
3. **VERIFY:** GitHub Actions exact SHA: full `npm test`, `npm run verify:source`, `npm run build:frontend`, and Workerd/D1 suites. Inspect failures before any merge.
4. **PR:** one draft scoped PR with RED/GREEN SHAs, check logs, file/RPC/table impact and known missing business gates; do not auto-merge.

## Accounting and release caveat

Original Google Sheets native deletion soft-hides refund rows and records Delete Log; this **synthetic fixture** instead retains immutable original rows and uses an inverse Cash credit plus a deletion-marker projection to prove net effects and traceability. Those are not byte-identical ledger presentation semantics. Before production, the M03 single posting owner must choose reviewed source-faithful audit projection, M04 must check session, actor, tenant and delete permission inside SQL, and M05/M06/M08 must reconcile exact original FIFO/stock/Party, split tenders and financial books. Do not promote synthetic tables, triggers or test worker to live D1 or mark M07 complete.
