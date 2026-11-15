# M03 Receipt Lookup Against the Actual M04 D1 Session Schema

**Date:** 2026-11-15. **Owner:** M03 core, read-only compatibility integration. **No production deployment.**
**Pinned source:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Problem and decision
PR #61 authenticated receipt readback with `synthetic_auth_sessions` containing `tenant_id` and `role_id`. M04's **actual reviewed test proposal** is different: `auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)`, with `auth_users` and `auth_roles`. It uses 30-minute idle time, absolute expiry, active staff and credential/role epoch checks. An adapter built against synthetic column names cannot integrate with that model.

Implement `createM04SingleBusinessReceiptReadback(env,{businessId})` in `src/db/m04-operation-receipt-read.js`. `businessId` is fixed on the trusted server **when constructing the adapter**, not passed by the request. Each D1 is assumed to belong to one business as specified in the migration plan. Until a separate multitenant authority ADR exists, **do not use this adapter with a shared tenant D1**: M04 sessions do not store tenant_id.

`reconcile_({token,nowMs,operationId,operationType,payload})` validates exactly five own-value keys. `token` is an opaque 64-character hex bearer token, never a client-supplied user/actor/hash. It is converted to bytes and hashed with SHA-256, identical to M04 `digestToken` in `src/auth/d1-auth-core.js`. `nowMs` is a trusted Worker clock value. The code accepts no `actorId` or tenant field in each call.

One parameterized D1 SELECT joins **actual** `auth_sessions` and `auth_users`, and LEFT JOINs fixture `operation_receipts` by trusted business ID and stable operation ID. Authorization matches all M04 session validation predicates: token digest, nonrevocation, created <= now, expires > now, last activity > now - 30 minutes and <= now, active user, matching user auth_version and credential_version, and **Administrator** built-in role with NULL role snapshot. For safety, custom staff role access is **explicitly denied** until source-faithful M04 permission mapping and server-side allowlist are approved, even if their sessions are valid.

Only after SQL returns a validated actor ID can the canonical fingerprint be recomputed. Identical committed receipt: `REPLAY` with original result ref and no writes. Same actor/operation ID with changed type/hash: `CONFLICT` without ref. Authorized absence: `NEEDS_REVIEW` (not retry authority). Other actor, expired/idle/revoked/stale or non-Administrator: `Denied`. Missing DB/malformed results: `NEEDS_REVIEW` error. No session heartbeat is updated by a readback. No post/reversal/financial mutations.

**Receipt table is still test-only.** Reuse the M04 test migration at `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` and a new disposable operation_receipts fixture schema. Never add to `migrations/**` or deployed Workers. The previous #61 adapter stays unchanged; this narrow alternate interface lets M03/M04 compare schemas without prematurely changing established tests. The two can be consolidated after approved migration and permission review.

## Evidence / limitations
TDD Node SQLite RED/GREEN and Workerd real local D1 RED/GREEN, including actual M04 login token compatibility, credential reset, status/role invalidation, idle boundary, exact original receipt, other actor/tenant receipt privacy, no public routes and attack-body ignorance. D1 read is one-time snapshot; it cannot confer write permission. Posting must perform authorization in its own atomic SQL mutation. PARALLEL-MODULE-READY stays false.
