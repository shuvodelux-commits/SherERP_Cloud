# M03 — Authenticated, tenant-scoped operation receipt readback contract

**Status:** INTERNAL ONLY. Tested against synthetic auth/receipt tables, **not** production authentication, finance, inventory, sales or a deployable RPC.

## Pinned source and merged dependencies

Source pinned: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Source-authenticated legacy cash/stock/ledger postings are not yet converted to awaited, durable D1 transactions.

The project already has a canonical intent fingerprint (PR #51), immutable read-only receipt reconciliation (PR #54) and test-only D1 session/version authorization proofs (M04 PRs #53/#57). The previous M03 reconciliation adapter accepts an `actorId` as an **internal-only, caller-trusted value**. It is not safe to expose as an RPC or to use a client-provided actor in a receipt lookup.

This increment proves that an internal readback can derive the actor from a current D1 session row with one SQL authorization/read statement. It does **not** use a previous JS preflight authorization result to fetch a receipt.

## Internal API and security model

```js
import {createAuthorizedOperationReceiptAdapter}
  from './src/db/authorized-operation-receipt.js';

const r=await createAuthorizedOperationReceiptAdapter(env).reconcile_({
  tokenHash: '<server-computed SHA-256 of opaque bearer>',
  tenantId:'TENANT-A', // trusted server scope, not a request assertion
  now:1000, // trusted server clock, not browser Date.now()
  operationId:'OP-1', // original stable ID
  operationType:'sales.post',
  payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}
});
```

The exact six-key input is validated strictly. `actorId` **cannot** be passed. The existing versioned SHA-256 JSON subset is validated before D1 access. A static bound SQL SELECT joins these **future/test-only** interfaces:
- `synthetic_auth_sessions` by exact token digest and tenant, not revoked and `expires_at > now`;
- `synthetic_auth_users` and `synthetic_auth_roles` by the session tenant/user/role, with active status, user role equality and matching user+role `auth_version` snapshots;
- a synthetic role flag `can_read_receipt=1` to represent a reviewed future read permission (this is **not** a real ERP role mapping);
- `operation_receipts` LEFT JOIN by tenant + operation ID, so an authorized session can get `NEEDS_REVIEW` when the receipt is absent.

Session authority and tenant-scoped receipt lookup occur in **one SQL SELECT**. The actor is read from the joined D1 session, not inferred from a request field. Only after that read is a canonical SHA-256 calculated with the *D1-derived actor*. The digest includes actor, tenant, operation type and exact canonical payload.

| Output | Meaning |
| --- | --- |
| `REPLAY` + original `resultRef` | The authenticated actor owns the committed tenant+operation ID and fingerprint matches; return original result, **never repost**. |
| `CONFLICT` (no resultRef) | The same actor has an immutable receipt, but type or payload differs. |
| `NEEDS_REVIEW` | A valid authorized session finds no committed receipt. Not safe to retry automatically. |
| `Denied` error | Missing, expired, revoked or invalidated permission/session, wrong tenant, or the receipt belongs to another actor. Never reveal receipt details. |
| `NEEDS_REVIEW` error | Invalid/malformed/ambiguous DB result or unavailable D1; no success claim. |

### Critical limitation

This is a **read authorization snapshot at the SQL SELECT time**, not durable write authority or an always-valid bearer grant. A revocation can race the subsequent JavaScript fingerprint calculation/response. It cannot retroactively cancel a read that preceded revocation. For real POS, payment, return or ledger writes, the **M04 authorization condition and posting/receipt constraints must be inside the atomic D1 write transaction**, not a separate preflight followed by writes.

Other important gates: M02 Party identity and independent account imports, complete source-shaped M03 async port, approved real M04 auth schema and permission policy, replay and signed reversal journals, Cash Session, FIFO, multi-unit/bundle/vendor accounting, source parity and reviewed production receipt lifecycle. Do not expose this helper through `src/index.js` or `src/rpc/**`.

## Tests and file impact

- `src/db/authorized-operation-receipt.js`: new internal read-only adapter; its synthetic join tables are absent from production migrations. Does not modify the existing `src/db/operation-receipt-reconcile.js`.
- `tests/fixtures/m03-authorized-receipt-schema.mjs`: test-only SQLite DDL for tenant-scoped roles, users, sessions and receipts, version-invalidating triggers; no deployed D1 schema changes.
- `tests/m03-authorized-operation-receipt.test.mjs`: in-memory Node SQLite integration verifying actor derivation, exact replay, changed intent conflicts, tenant/user isolation, expiry/revoke, user/role permission invalidation, malformed DB rows and fail-closed input.
- `tests/fixtures/m03-authorized-receipt-worker.mjs`, `wrangler.m03-authorized-receipt-test.jsonc` (all-zero local D1 UUID), `tests/integration/m03-authorized-receipt-workerd.spec.mjs`: real Workerd/D1 integration, test-only hardcoded routes, no public RPC, HTTP body ignored.
- `tests/integration/m03-workerd.spec.mjs`: one import adds the suite to existing GitHub PR-only test job.
- Design and plan under `docs/superpowers`. This is a **new implementation** rather than byte-for-byte source copying or automatic conversion.

**Unchanged:** `migrations/**`, exact two-migration/seven-table staging gate, Worker deployment/preview settings, production secrets or D1 bindings, `src/index.js`, `src/rpc/**`, all 84 frozen original files, original user UI, production Party/stock/cash/finance tables. No remote writes. Revert this PR to remove all changes. `PARALLEL-MODULE-READY` remains **false**.
