# M03 — Exactly-One Changed-Row Transaction Assertion (internal only)

**Status:** Reviewed-in-progress, synthetic-data-only M03 transaction prerequisite. **Not** a production accounting, inventory, POS, finance, order, session or idempotency implementation.

## Why this exists
The pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` relies on original GAS `LockService` plus sequential Sheets writes in `Sales.gs`, `StockLots.gs`, `Purchase.gs`, `CashSession.gs` and `Database.gs`. Cloudflare Workers/D1 is asynchronous and cannot emulate the GAS lock with JavaScript state. D1 `batch()` runs SQL transactionally, but **zero rows affected** by a guarded SQL `UPDATE` does not normally raise a SQL exception. Simply inspecting results *after* a successful batch would be too late to undo earlier writes.

## Internal interface
```js
const guard = createD1ExactlyOneBatchGuard(env);
await guard.execute_([
  env.DB.prepare('INSERT OR IGNORE INTO ...').bind(operationId, payloadHash),
  env.DB.prepare('UPDATE ... WHERE stock >= ?').bind(quantity),
  env.DB.prepare('INSERT INTO ...').bind(...)
]);
```
The caller supplies a nonempty list of already-bound, **trusted, reviewed** D1 DML statements exposing `all()`. This helper does not accept raw SQL strings, user-supplied identifiers, request bodies, a table name, an operation ID, or a webhook payload itself. There is no endpoint in `src/index.js` or `src/rpc`.

The executor inserts a fixed SQLite assertion **immediately after every DML** inside the same `DB.batch()` transaction:

```sql
SELECT CASE WHEN changes()=1
  THEN 1
  ELSE json_extract('M03_ASSERTION_FAILURE_NOT_JSON','$')
END AS changed_one;
```

`changes()` is the count from the immediately preceding DML statement. If the count is not exactly 1, deliberately invalid JSON triggers a SQLite error, making the *whole batch* fail and roll back. This assertion is a real SQL-level abort, not an after-commit metadata check. The helper rejects missing D1/batch bindings, empty inputs, nonprepared objects, malformed batch result shapes and missing assertion results. Post-batch result errors are treated as **unknown outcome: reconcile**, not proof of rollback.

### What this does not guarantee
The SQL assertions cannot verify that the caller picked the correct source row, actor, amount, sign, payment account or operation fingerprint. The caller still must supply server-verified identity, permission checks, unique durable operation IDs, stable request fingerprints, guarded stock and obligation quantities, all child posting SQL and reconciliation logic. On replay, a duplicate operation claim fails the batch without posting again; the future authorized module must query an immutable prior receipt by the same operation ID and compare the fingerprint to distinguish a legitimate replay from conflicting payload. Blind retry with a new ID is unsafe.

This is **exactly-one-per-statement**, not a general multirow DML primitive. Any future multirow posting must use a separate explicitly reviewed cardinality contract. A `DELETE/REPLACE` or deliberately misleading SQL statement can defeat assumptions; only approved fixed SQL modules may call this helper.

## Synthetic real-D1 proof
A dedicated, nondeployable `wrangler.m03-exactly-one-test.jsonc` uses an all-zero synthetic D1 UUID. The test harness creates four isolated test-only tables directly in local D1:
- `proof_operations`: stable operation IDs and fingerprints.
- `proof_stock`: dummy stock with nonnegative CHECK.
- `proof_journal`: dummy journal line.
- `proof_receipts`: operation receipt and fingerprint.

The fixed test Worker accepts **no** user-selected IDs, SQL, tables or quantities; all actions are source constants. Real local Workerd+D1 tests verify a successful four-statement posting, same-ID replay refusal, changed-fingerprint collision refusal, zero-stock guarded update rollback, later journal constraint error rollback, two concurrent distinct IDs competing for one remaining item, a two-row mutation abort, and request-injection resistance. The Node SQLite unit suite independently verifies the same gate with an actual SQLite `BEGIN IMMEDIATE` / `ROLLBACK` test shim. The existing PR-only M03 GitHub Actions test entry imports this additional synthetic Worker; deployment workflow remains unchanged.

## Boundaries and recovery
- Files: `src/db/exactly-one-batch.js`; `tests/m03-exactly-one-batch.test.mjs`; `tests/integration/m03-exactly-one-workerd.spec.mjs`; `tests/fixtures/m03-exactly-one-worker.mjs`; `wrangler.m03-exactly-one-test.jsonc`; one import in `tests/integration/m03-workerd.spec.mjs`; this document and Superpowers design/plan.
- No schema migration, real financial table, public Worker endpoint, source GAS mutation, Cloudflare production/staging D1 binding, production data import or operational posting path is changed.
- Revert this PR to recover. Synthetic test data are disposable and local only; no remote rollback is required.

**Still blocked:** full M03 async/data conversion; complete M02 import, M04 D1-backed authenticated sessions/RBAC/last-admin protections; signed account-separated atomic posting, idempotent cross-module reversal, Cash Session, FIFO and M05–M08 integration. `PARALLEL-MODULE-READY` remains false. Do not enable financial or business endpoints based on this proof alone.
