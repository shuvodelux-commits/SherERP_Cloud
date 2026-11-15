# M03 → M04: schema-aligned authenticated receipt readback

**Status:** Read-only **internal compatibility contract**, not a deployed RPC or financial posting capability. The M04 auth schema and `operation_receipts` in this proof exist **only in local test fixtures**.

## Why

M03's earlier authenticated receipt readback (PR #61) is based on the synthetic tables `synthetic_auth_sessions`, `synthetic_auth_users` and `synthetic_auth_roles`. The M04 authentication work that followed (PRs #55, #60, #70) has a different proposed D1 schema:

- `auth_sessions` stores a SHA-256 digest of the raw opaque token, `user_id`, `user_auth_version`, `credential_version`, optional `role_auth_version`, session creation/activity/expiry timestamps in milliseconds, and revocation.
- `auth_users` stores current status, role and both auth and credential epochs.
- `auth_roles` is used for custom roles; **Administrator** is an intrinsic role with `role_auth_version IS NULL`.
- M04 requires 30-minute idle expiry, independent of the absolute session lifetime.

The old synthetic test schema and proposed M04 schema are not interchangeable. The new adapter verifies compatibility with **the actual M04 proposal fixture** rather than inventing a second session model.

## Internal API

```js
import {createM04SingleBusinessReceiptReadback}
  from './src/db/m04-operation-receipt-read.js';

const readback=createM04SingleBusinessReceiptReadback(env,{
  businessId:'BUSINESS-A' // trusted Worker configuration, not request input
});

const outcome=await readback.reconcile_({
  token:'<raw opaque 64-hex session bearer>',
  nowMs:1800000000000, // server-trusted clock, never browser clock
  operationId:'OP-1',
  operationType:'sales.post',
  payload:{items:[{sku:'PIPE',units:'1.000'}],total:'120.00'}
});
```

**Do not deploy or expose this interface as a public RPC.** The adapter does not itself process or transport credentials securely. In this test, the caller supplies the bearer token returned by the M04 internal login method, and the adapter computes `SHA-256(hex-decoded-token)` to match M04's actual stored session digest. The actor is always retrieved from D1. Neither `actorId`, `tenantId` nor a payload digest is accepted per request.

The server-fixed `businessId` scopes the immutable receipt lookup and canonical intent hash. M04's current auth session schema has **no tenant identifier**, consistent only with the migration plan's initial assumption of one business per isolated D1 binding. **Unsafe for a shared multitenant D1:** the session and requested business are not cryptographically bound in the proposed M04 tables. Do not connect this to any shared database without a new reviewed tenancy/security design.

## Authorization rules and responses

One fixed, parameterized SELECT joins M04's session and user records, then LEFT JOINs the committed receipt. It confirms, at the time of the SELECT:

- Stored SHA-256 session digest and no revocation.
- `created_at_ms <= nowMs`, `expires_at_ms > nowMs`.
- `last_activity_at_ms > nowMs - 30 minutes` and `last_activity_at_ms <= nowMs`.
- Active user, matching `auth_version` and `credential_version` snapshots.
- Built-in **Administrator** status with NULL role snapshot.

Other/custom staff roles are **deliberately denied**, even with valid M04 sessions. This is a temporary fail-closed policy, not SherERP's final permission map. Role-specific Sales viewing and receipt reconciliation permissions must be reviewed against the frozen GAS source and M04 allowlist before access expands.

| Result | Meaning |
| --- | --- |
| `REPLAY` + original `resultRef` | Authorized actor matches a committed receipt's actor, operation class and versioned payload digest. Return original reference, **never repost**. |
| `CONFLICT` | Same committed operation ID/actor, but changed type or payload hash. No prior receipt reference. |
| `NEEDS_REVIEW` | Authorized original operation ID has no committed receipt. This is **not** permission to retry with a new ID. |
| `Denied` error | Missing/expired/idle/revoked/invalidated session; custom staff role or another actor's receipt. No private details. |
| `NEEDS_REVIEW` error | Bad SQL result, unavailable D1 or invalid stored receipt. Fail closed. |

No SQL write or heartbeat is performed. **A read-only permission check is a point-in-time snapshot, not a grant to post money or stock.** Actual posting authorization must be rechecked in its atomic D1 write, as demonstrated separately by M03 PR #69's *synthetic* posting contract.

## Tests and boundaries

- New `src/db/m04-operation-receipt-read.js` internal read-only adapter.
- Node test `tests/m03-m04-receipt-read.test.mjs` applies the **unchanged actual M04 SQL proposal** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` in-memory, plus a local-only immutable receipt fixture. Covers real M04 login token issuance compatibility, actor/receipt ownership, role denial, idle and expiry, revocation, user disable/re-enable, credential reset and role assignment.
- Workerd test `tests/integration/m03-m04-receipt-workerd.spec.mjs` uses a nondeployable Worker and the same existing M04 SQL migration fixture. It verifies a token issued by real M04 `loginWithD1` against local D1 and demonstrates immutable receipts, changed intent conflict, and other-actor privacy. The test Worker never parses request body, offers no arbitrary SQL and cannot expose a real RPC.
- Test-only fixture `tests/fixtures/m03-m04-receipt-schema.mjs` and all-zero dummy D1 UUID `00000000-0000-0000-0000-000000000012`.
- Existing `tests/integration/m03-workerd.spec.mjs` gains one import to include this suite in PR CI. Existing `createAuthorizedOperationReceiptAdapter` and M04 auth code are unchanged.

**No deployable migration, no production D1 bind, no auth/login RPC enablement, no public receipt lookup, no original GAS/UI modification, and no financial data write.** Staging still enforces its original two-migration/seven-table gate. Revert the PR to remove these isolated files and one test import. `PARALLEL-MODULE-READY=false`; M02 source import, actual M04 schema/RBAC cutover, full transaction/lot/accounting parity and approved immutable receipt lifecycle remain prerequisites.
