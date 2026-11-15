# M03 — Immutable operation receipt reconciliation after unknown D1 result

**Scope:** Internal M03-only read adapter and **test-only synthetic receipt table**. This PR does **not** ship a deployable receipt database table, an authenticated RPC, production posting or a financial transaction kernel.

## Source, dependency and rationale

SherERP's source of truth is frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. An HTTP failure can occur after an atomic D1 batch has committed. Automatically creating a new operation ID in response is unsafe: stock, tenders, accounts and journal rows might be posted twice. Merged PR #49 demonstrated a synthetic D1 operation-ID claim; merged PR #51 provided a canonical intent fingerprint including server-trusted tenant, actor, operation type and payload.

This adapter closes the *readback policy* gap: after a lost response, look up the **original** tenant/operation ID, compare its canonical intent with a durable **committed** receipt, and never interpret an absent row as safe to repost. Receipt writes must ultimately be inside the exact same DB transaction as financial/stock postings, not an HTTP follow-up.

## API

```js
import {createOperationReceiptReconciliationAdapter}
  from './src/db/operation-receipt-reconcile.js';

const result=await createOperationReceiptReconciliationAdapter(env).reconcile_({
  tenantId:'TENANT-1',            // verified on the server, NOT client supplied
  operationId:'OP-42',           // original, stable ID; never rotate on retry
  actorId:'staff-1',             // authenticated server actor
  operationType:'sales.post',   // allowlisted server operation class
  payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}
});
```

The method validates the **exact five input keys** and operation ID pattern `^[A-Z0-9_-]{1,64}$`, then recomputes a versioned SHA-256 from the four canonical intent fields using the merged `hashCanonicalOperationIntent`. It never accepts a digest claimed by the client.

One fixed, bound, tenant-scoped SQL query reads from the **not-yet-migrated** `operation_receipts` table: `WHERE tenant_id=? AND operation_id=? LIMIT 2`. The result has one of these shapes:

| Result | Meaning |
| --- | --- |
| `{status:'REPLAY',operationId,resultRef}` | One immutable committed receipt matches tenant + original operation ID + actor + operation type + payload digest. Return the **original result reference**, do not repost. |
| `{status:'CONFLICT',operationId}` | A committed receipt exists for that tenant/operation ID but the actor/type/hash differs. No receipt details are returned. |
| `{status:'NEEDS_REVIEW',operationId}` | No receipt is present. This does **not** authorize changing the operation ID or blind retry. |
| Error prefixed `NEEDS_REVIEW` | D1 is inaccessible or returned ambiguous/malformed data. Do not assume rollback. |

There is no query cache, JS read-modify-write or public route. Invalid inputs reject before DB access. The actual table's tenant and operation IDs are validated against the requested identity; unexpected rows or duplicate results fail closed.

## Why only a test-only receipt schema now

The approved staging migration gate requires **exactly two migrations and seven application tables**. This PR does not weaken `scripts/guard-remote-staging.mjs`, create `migrations/0003*`, add a D1 binding to a deployed Worker or run remote migrations. Future operation receipts must be reviewed with M02 data ownership, M04 actor/role policy, signed posting, idempotency and exact-once reversal before introducing a production table.

`tests/fixtures/m03-receipt-schema.sql` is installed **only** in Node :memory: SQLite and the local synthetic Wrangler Workerd+D1 fixture. Its `operation_receipts` table uses a unique composite `(tenant_id,operation_id)` key, immutable committed actor/type/fingerprint/result reference, and two triggers prohibiting UPDATE and DELETE. Committed-only receipts mean a failed batch must leave **no** row. A future real receipt schema may require additional tenant, reversal, audit and retention fields and will be a separately reviewed migration.

## Actual D1 proof

The isolated synthetic worker `tests/fixtures/m03-receipt-worker.mjs` and dummy D1 UUID in `wrangler.m03-receipt-test.jsonc` are not production imports. They use fixed hard-coded actions; HTTP bodies cannot select SQL, tenant, actor, source record or amount.

The Workerd tests create local test tables and demonstrate:
- Before a commit, the original operation ID returns `NEEDS_REVIEW`.
- A D1 `batch()` inserts receipt, reduces dummy stock and inserts dummy journal, **then the test Worker deliberately returns HTTP 503**. The DB has committed.
- Reconciliation after that ambiguous response returns `REPLAY` and the original `SALE-7` reference; reordered JSON keys still replay.
- Changed amount, actor or operation class returns `CONFLICT` and never discloses `SALE-7`.
- Identical operation IDs across two separate tenant identities do not leak or share receipts.
- A late synthetic journal constraint failure rolls back **both** previous stock and receipt inserts, so the same operation ID returns `NEEDS_REVIEW`.
- Duplicate replay, receipt UPDATE/DELETE, forged client body and unrecognized routes cannot mutate the DB.

Node SQLite tests independently verify the read adapter and immutable synthetic schema. Existing PR-only Workerd CI runs the added suite via `tests/integration/m03-workerd.spec.mjs`. No production Worker, schema or original UI/source was changed.

## Owner and remaining gates

M03 core owns this isolated interface. Actual operation result IDs, authenticated actor authority, exactly-once append/reversal, Party accounts, Cash Session, FIFO, retries and financial journaling are not implemented. Missing receipt after a network partition cannot by itself distinguish *never committed* from *in-flight*: user-facing retry must not be enabled solely from this read.

**PARALLEL-MODULE-READY remains false.** Restore by reverting the PR; all introduced data is synthetic and disposable, and staging/production were not touched.
