# M06 — isolated Workerd/D1 atomic POS posting acceptance proof

**Status: TEST FIXTURE ONLY.** No production/staging D1 migration, new Worker RPC, public auth integration, real posting engine or source-data import is authorized here. This PR builds directly on **merged M06 source-faithful split-payment port PR #64** and the current `main` branch. `PARALLEL-MODULE-READY=false` until dependency review.

## Source and responsibility

- Frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains untouched. M06 source: `Sales.gs::completeSale`, `SalePayments.gs` pure split functions, `CashSession.gs::requireActiveCashSession_`, plus `DraftSales.gs`, `Invoice.gs`, `SalesManagement.gs` for later posting, reads and updates. The source-pinned first M06 slice adds `src/modules/sale-payments.js`; this PR **imports**, does not modify, that module.
- Reuse M03's `hashCanonicalOperationIntent` versioned SHA-256 for replay fingerprinting. Tenant and actor are **test harness injected trusted inputs** here, not HTTP-authorized identities. M04 authenticated actor + authority versions inside D1 claim, M05 real lot/FIFO/bundle/OVERSOLD and M02-P reviewed Party links are still missing and block actual sale posting.
- Production ownership is M03 shared DB/posting core, M04 auth/session, M05 stock and M08 finance. This PR introduces only M06-specific `tests/fixtures/m06-*` files, `tests/integration/m06-*`, a fake Wrangler test config, two Node isolation tests, and one import line in the existing PR-only local-D1 integration aggregate. No real `src/**` changes, migrations, original UI or deployed Worker configs.

## Minimal but real D1 financial safety experiment

One synthetic standard SKU, integer-owned stock and exact integer-paisa sales: `createSyntheticD1SalePostingContract(DB)` accepts an operator/tenant fixture context, validates a stable 12–100 char operation ID, checks current account rows through the copied source split calculator, computes M03's canonical fingerprint, then makes one `DB.batch()` with:

1. `INSERT INTO m06_invoices ... SELECT ...` guarded **within SQL** by open Cash Session (including all-Due invoices), sufficient owned stock, reviewed specific Customer legacy link when due is positive, and current bank/mobile account activation + matching type. `(tenant_id,operation_id)` uniqueness plus `ON CONFLICT DO NOTHING` enforces one receipt.
2. An `AFTER INSERT` SQLite trigger that conditionally updates owned stock (with mandatory affected-row assert), creates exactly one sale item and stock movement, builds tender children using `json_each`, checks `SUM(applied)=paid`, re-checks bank account activity/type, posts only **applied** cash/bank credits, incrementally updates **the selected Customer** receivable if due, and records one source-linked Customer ledger row. Supplier payable remains a separate untouched account.
3. A same-batch query of the immutable operation record to distinguish `COMMITTED`, `REPLAY`, `CONFLICT` and `DECLINED`. SQL/transport ambiguity is surfaced as `NEEDS_REVIEW`; never mint a new operation ID after an unknown outcome. A returned Cash change is receipt metadata and does **not** become Cash Book income.

The trigger executes in the same SQLite statement as the invoice insert; one forced child/ledger error rolls back the entire statement and transaction, including stock and the operation key. A **zero-row** guarded invoice claim cannot fire the trigger or post any child. Multiple concurrent due invoices use SQL increments rather than stale read/modify/write and cannot lose receivable updates.

### Local D1 acceptance evidence

`node --test tests/integration/m06-sale-posting-workerd.spec.mjs` runs on the **actual local Workerd+D1** binding, not an in-memory JS DB; its fully fake `DB` UUID ends in `0016` and has no route or cloud deployment. The suite covers:

- Full Cash change (applied vs tendered), mixed Bank/Mobile/Cash with exact paisa, all-Change Cash while Bank covers the invoice, all-Due invoice with zero payment children, selected Customer partial due without Supplier offsets.
- Identical operation replay with unchanged cash/stock/Party effects, changed payload/actor ID conflict, and per-tenant operation-ID isolation.
- Last-owned-item simultaneous sales (one only), simultaneous Customer due increments without lost updates, stale preflight stock, bank status, reviewed Customer link and cash-session closure races.
- Failure-injected payment child, Cash Book, Bank Book and Customer ledger writes, each requiring zero partial source/item/stock/cash/bank/receivable/operation effect.
- Invalid amounts/accounts/row IDs and immutable posted invoice, 404 test Worker, clean registry and public Worker isolation.

Node-only `tests/m06-d1-sale-isolation.test.mjs` checks the bounded configuration and explicit reuse of source payments and canonical digest. The aggregate M03 Workerd CI imports the independent M06 fixture so GitHub tests must run real local D1 on PRs. Source verification and frontend build must remain unaffected.

## Explicit NONcoverage / release barriers

**This is not the completeSale port.** The synthetic fixture accepts integer units and one standard owned-stock SKU per invoice; it does **not** implement: real FIFO lots (purchase date + lot ID), negative-stock/OVERSOLD, consignment/vendor sourcing, bundle component snapshots, multi-unit quantities, invoice ID allocation by DB sequence, cash-session overlap/settlement lifecycle, real Party/Bank/Customer tables, cash-session/actor/permission-version authorization inside the SQL claim, all original invoice metadata, draft consumption, persistent reversal/edit flow, authorized receipt retrieval after a bank/account change, source fixture profit parity, original browser checkout/print flows or staging import reconciliation. `m06_*` tables and SQLite trigger are **a proof**, not approved production schema or a second accounting kernel.

For the actual M06 implementation, integrate source-backed M05 FIFO planning and source Party role-link mapping with M03's shared signed posting core; use SQL-level M04 session and permission-version checks from the real actor, one reviewed migration/rollback and source parity tests. Keep D1 writes disabled on public previews. A real authenticated, source-complete `completeSale` can be activated only after the full M06 acceptance matrix in `docs/WORKSTREAMS.md` passes and owner explicitly reviews it.

**Recovery:** revert these test-only files and one integration import. No data migrations, ledger changes, Cloudflare secrets, live tenant records or production recovery actions are involved.
