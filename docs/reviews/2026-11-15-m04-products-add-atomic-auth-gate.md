# M04 → M03 Product master create: exact-mutation authorization contract

**Status:** Approved project sequence, design/review only. This is NOT implemented or approved for live RPC. **Source pin:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, ProductSettings.gs addProductCategory/addProductUnit and Auth.gs permissions.

## Existing evidence

- PR #230 merged original Unicode-aware Category/Unit creation preflight (read-only).
- PR #248 is a separate local-only atomic PCAT/PUNT source-ID+cleanup+insert Workerd D1 proof, backed by test-only triggers and immutable operations; no deployed schema or staff authorization.
- M04 has local-only auth_sessions/auth_users/auth_roles schema proposal at tests/fixtures/m04-auth-migrations/0001_auth_core.sql and proven internal settings.view/settings.edit and reports.view auth patterns. These are NOT production D1 migrations.
- src/rpc/registry.js remains empty; public RPC is deliberately fail-closed. No public products.add or products.edit handler exists.

## Required exact SQL authority on creation

The *same SQLite INSERT statement* that fires an atomic Product master creation trigger must require valid current M04 session and source-granted **products.add**. A separate JS SELECT or successful preflight cannot authorize the later write, because roles, sessions and user status may change between the two operations.

Required auth predicate: token hash calculated from opaque 32-byte bearer (not UTF-8 hex string); non-revoked session; created_at_ms <= trusted now; expires_at_ms > now; last_activity_at_ms within the 30-minute idle window; active Modern user; credential and user authority versions equal the session; Administrator only with null role epoch OR non-Administrator with active role, equal role epoch, valid bounded JSON and literal true at $.products.add. Actor identity comes exclusively from SQL joined auth_users, never from request or Party role. The one-business-per-D1 context must match the reviewed M04 schema; do not imply shared-tenant isolation.

The insert must create **zero rows without any side effects** on failed authority; the internal caller returns one generic denial, never a source-id or private status leak. The immutable operation result/receipt must be bound to the session-derived actor and original intent, so another actor cannot replay or read it. Every replay/readback must independently prove current M04 authority, including after password rotation, logout, role revocation or account disablement. A successful user-level check cannot override SQLite snapshot mismatch or ID counter failure.

**Important design gap:** PR #248 synthetic creation intents/receipts do not yet record D1-derived actor identity and its static trigger has no M04 auth SQL. Extending that model for real staff is a **separate reviewed schema/operation PR**, not an opt-in flag or merely a wrapper; it requires a new user/actor binding and importer/cutover compatibility decision.

## Role requirements

- addProductCategory and addProductUnit require source products.add.
- setProductCategoryStatus and setProductUnitStatus require products.edit; activation and permanent removal both require current edit permission.
- Roles from Party (Owner/Lender/Vendor/etc) are business relationships, NOT staff permission grants.
- Public RPC must have an exact allowlist, parameter/shape validation, session-bound trusted business context, generic denial, and no dynamic method invocation.

## RED→GREEN tests needed before wiring any RPC

1. Real local Workerd D1 M04 schema + catalog receipt trigger: valid Administrator creates one source PCAT/PUNT record atomically.
2. Active, version-matched nonadmin role with literal true products.add can create; false, string 'true', missing permission, malformed JSON, disabled role/user or stale role epoch all deny without mutation.
3. Revoked, logged-out, expired, idle or rotated-credential sessions deny with no source counter, receipt, catalog or intent effects.
4. Race revocation with actual INSERT statement; only transactions serialized before revocation may commit. Auth-read in JS followed by unguarded insert must fail the regression.
5. Same operation replay by same current actor returns same ID; replay by another actor or with changed hash rejects; lost reply and retry do not duplicate.
6. Source inactive duplicate cleanup, same-name race and forced late insert failure roll back **both** permission-gated receipt and catalog/counter changes.
7. Public Worker/RPC stays 501 and no remote database binds until approved M02/M03/M04 migrations, source data reconciliation and rollback plan.

**Owner/sequence:** M03 owns shared SQL/transaction; M04 owns session/RBAC contract; owner reviews both before enabling. First merge PR #248 after exact-head real Workerd CI. Then implement the actor-bound SQL authority and RED tests on a separate GitHub branch/PR. Only after this succeeds may public handler registration be proposed, and that itself requires a cutover approval. This design alone does not satisfy M04 readiness.