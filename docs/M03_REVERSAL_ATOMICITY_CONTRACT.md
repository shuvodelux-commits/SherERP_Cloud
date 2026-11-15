# M03 — exactly-once owned-stock reversal (synthetic transaction proof)

**Status:** Internal M03 transaction acceptance test, **not** a production return, deletion, refund, financial posting or inventory implementation. No public RPC is activated.

## Pinned source behavior and scope

Source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- `legacy/source/DeleteEngine.gs#deleteSalesInvoice` requires delete permission and an active Cash Session, refuses invoices that already have Sales Returns, demands original `SALE_ITEM_LOTS` owned-stock evidence, and excludes vendor-sourced quantities from owned stock. Split-payment invoices have a stable delete operation ID and journal with original invoice/payload hash evidence. Missing/mismatched journal or later settlement information requires review.
- `legacy/source/StockLots.gs#planSalesReturnStockUndo_` requires source return/movement evidence and refuses unsupported undo.
- `legacy/source/SalesReturn.gs#deleteSalesReturn` replays a prior committed correction only after checking consistent deleted state; otherwise it requires Needs Review.

This PR **only** demonstrates tenant-scoped exactly-once owned-stock restoration in a disposable D1 sandbox. It does **not** model original invoices, multiple items/lots, FIFO, bundles, vendor sourcing economics, split tenders, Cash/Bank/Party debits, permissions, Cash Sessions, historical dates, linked refunds, source DeleteEngine semantics or real deletion of any existing record.

## Atomic and idempotent test-only contract

`tests/fixtures/m03-reversal-contract.mjs` exports
`createSyntheticD1ReversalContract(DB).reverse({tenantId,actorId,reversalId,originalOperationId,originalHash,units,reason})`.

These fields are internal test-only inputs. The test Worker takes them from code constants, **never** untrusted request body. A future production integration must obtain tenant and actor from M04 authenticated context, validate source business rules and amounts, and choose an approved stable reversal ID.

The test helper computes a versioned canonical `sales.reverse` intent digest using merged PR #51, including tenant, actor, original operation ID, original hash, proven owned units and exact reason. It accepts only exact validated arguments, 64-character lowercase original hash, a stable reversal ID and positive integer units.

One real D1 `batch()` executes two fixed bound statements, without JavaScript preflight reads between writes:

1. `INSERT ... SELECT ... ON CONFLICT DO NOTHING RETURNING` reserves a committed reversal **only if** the original operation is committed, exact ID/hash/units match, original movement is marked `OWNED`, the original owned movement matches the exact SKU and units, and there is no active return. Synthetic D1 UNIQUE keys prohibit both reuse of `(tenant_id,reversal_id)` for a conflicting action and double-reversal of `(tenant_id,original_operation_id)` under a different ID.
2. A tenant-scoped `SELECT` in the same batch reads the immutable reversal to classify `REVERSED`, `REPLAY`, `CONFLICT` or `DECLINED` and return the original resultRef for an identical replay.

An `AFTER INSERT` **test-only SQLite trigger** restores stock and writes one inverse movement as part of that **same INSERT statement**. A missing stock row raises an ABORT via SQL `changes()` check; a deliberately failing inverse journal trigger also aborts. Either fault rolls back the reversal reservation and any stock changes. There is no separate post-commit JS update. Immutability triggers forbid update/delete of committed reversal and inverse movement rows.

Any malformed batch response raises `NEEDS_REVIEW`. A replay is not a second reversal. A changed actor/reason/hash, or a new reversal ID against an already-reversed original, is `CONFLICT`, not an additional stock correction. No hidden cache or duplicate-correction engine exists.

## Actual local D1 proof

`tests/fixtures/m03-reversal-schema.mjs` defines **test-only** tables for original operation, owned/vendor movement, stock, committed reversal and inverse movement. The fake D1 UUID `00000000-0000-0000-0000-000000000009` in `wrangler.m03-reversal-test.jsonc` is never deployed or bound to any public Worker; all schema SQL is applied only to disposable Node in-memory SQLite and local Workerd/D1 in tests.

Unit and real Workerd coverage verifies:
- Proven owned movement reversal restores exactly one owned unit and appends exactly one immutable reversal movement, preserving original identity and authenticated-actor *shape* (the test actor itself is synthetic).
- Identical replay has no stock/journal effect; changed reason/actor/source hash or a second reversal ID conflicts.
- Concurrent different IDs on one original: exactly one reversal commits, one conflicts, stock increases once.
- Same operation/reversal IDs in separate tenant scopes do not share stock or evidence.
- Vendor-only sourced item, active return, nonexistent original or missing owned movement refuse reversal; stale hash after an already-committed reversal conflicts.
- Missing stock or an injected journal failure rolls back reversal reservation and stock in **real local D1**.
- Receipt/evidence UPDATE/DELETE is blocked; missing/wrong HTTP methods and attacker-supplied identity/SQL are ignored/refused.
- Exact input validation and malformed D1 response handling fail closed.

The existing `tests/integration/m03-workerd.spec.mjs` gains one import so the normal no-secret, PR-only GitHub Actions suite runs the real-D1 tests.

## Impact, dependencies and readiness

- **New only:** test-only schema, helper, Node tests, local Workerd test Worker/config/integration tests, Superpowers design and plan, this document.
- **One existing-file edit:** the M03 integration suite import. No other source changes.
- **Unchanged:** `src/db/**`, `migrations/**`, staging's two-migration/seven-table contract, `src/index.js`, `src/rpc/**`, Cloudflare deployment/previews/secrets, original 84 pinned source files, user-facing HTML/JS/CSS, Party/accounting data and real stock.
- **Recovery:** revert this PR; synthetic test data are disposable, and no remote D1 or production data was written.
- **Owner:** M03 synthetic transaction contract only. M02 import/reconciliation, M03 awaited full call graph, M04 persisted auth and approved role allowlist, shared invoice/stock/ledger posting/reversal, source-accurate FIFO, Cash Session and audited correction approval are not satisfied. The PR is not a substitute for M07 returns and corrections.
- **Readiness:** `PARALLEL-MODULE-READY = false` until the documented independent gates pass.
