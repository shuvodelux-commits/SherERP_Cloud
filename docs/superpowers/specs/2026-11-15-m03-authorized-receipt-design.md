# M03 Authorized Immutable Receipt Lookup — Internal Design (2026-11-15)

**Owner:** M03-core. **Source pin:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
**Status:** Internal read-only adapter with synthetic auth/receipt D1 fixtures, NOT functioning production auth or financial posting.

## Need and background

Merged M03 PRs #49/#51/#54 and #48 prove local D1 posting, versioned canonical intent fingerprint, immutable receipt readback, and atomic guarded batches. M04 PRs #53/#57 prove immediate role/user authority/version checks in the D1 statement for synthetic mutation. The internal M03 readback primitive `createOperationReceiptReconciliationAdapter` trusts its supplied `actorId` and is intentionally not public. This incremental interface proves a **single D1 SELECT** can check session validity and read only the matching tenant receipt, deriving actor identity from the validated session, rather than trusting a browser identity or doing two preflight queries.

## Design

`createAuthorizedOperationReceiptAdapter(env).reconcile_({tokenHash,tenantId,now,operationId,operationType,payload})`:
- Exact six-key own-data object only. `tokenHash` is a lowercase 64-character SHA-256 digest derived server-side from an opaque bearer session; `tenantId` from verified server tenancy; `now` is a nonnegative safe integer from trusted Worker clock. `operationId` is stable [A-Z0-9_-] 1–64. `operationType` is allowlist-validated later by business module. Caller **never** supplies `actorId`.
- New `src/db/authorized-operation-receipt.js` uses fixed bound SQL against **test-only future schema names** `synthetic_auth_sessions`, `synthetic_auth_users`, `synthetic_auth_roles` plus `operation_receipts`. One SELECT atomically tests: digest, requested tenant, no revocation, current expiry, active user and role, user role association, matching user/role auth_version and `can_read_receipt=1`; LEFT JOIN the committed receipt by tenant/op ID.
- If no authorized user row => generic `Denied`, no receipt existence/reference disclosure. For a valid session: no receipt => `NEEDS_REVIEW`, never safe retry. If receipt belongs to another actor => generic `Denied` (no conflict existence disclosure). If same actor/type/hash => `REPLAY` + original `resultRef`. If same actor but changed type or payload hash => `CONFLICT`, no result reference. Malformed or ambiguous result => `NEEDS_REVIEW`; failed D1 => `NEEDS_REVIEW` error.
- After reading actor from D1, recompute versioned canonical hash with merged #51. This is an **authorization snapshot at D1 SELECT time**, not an always-valid bearer grant. It must never be used as a write preflight; future financial writes need M04 permission verified *within their SQL write transaction*. It is a readback-only integration candidate.
- No production auth migration, no public RPC, no static assets change, no money/ledger/stock mutations.

## Alternatives
- Separate `resolveSession()` and receipt SELECT: reject for avoidable revocation/version race and tenant-leak risk.
- Client-supplied actor + `createOperationReceiptReconciliationAdapter` in public RPC: reject (forgeable).
- Join directly with deployed M04 tables now: reject; session schema not yet approved/merged, staging enforces exactly 2 migrations/7 app tables.
- Synthetic isolated D1 join: chosen until authenticated M04 schema and posting kernel are finalized.

## Verification
Node SQLite read-only cases including valid owner replay, reordering, missing receipt, other actor, expiry/revocation/disable, role downgrade/version, other tenant, malformed D1. Real local Workerd with test-only fixtures, including mutation between lookups and session invalidation. Frozen source and CI/workerd checks remain mandatory. `PARALLEL-MODULE-READY` stays false.
