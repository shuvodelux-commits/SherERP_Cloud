# M03/M04 — Atomic Product Master Creation With Current Staff Authority

**Source of truth:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, `ProductSettings.gs::addProductCategory/addProductUnit` and `Auth.gs::requirePermission_`. **Depends on:** merged PR #248, #250, and issue #252. **Deployment:** NONDEPLOYABLE local D1 proof only.

## Goal
Prove that a current M04 session and a source `products.add` permission are checked in the **same SQLite INSERT that commits M03 Product Category/Unit creation**. Persist the D1-derived actor on immutable creation intent/receipt. Unauthenticated, revoked, expired, idle, disabled, stale-version and malformed permissions must never alter source PCAT/PUNT counter, catalog, cleanup or receipts.

## Approach
Keep `src/modules/m03-product-master-atomic-create.js` and its test-only schema untouched. New local-only `src/modules/m04-authorized-product-master-create.js` composes the reviewed async M03 read adapter and a **fixed, parameterized** insert-select from actual proposed M04 `auth_sessions/auth_users/auth_roles`. The actor is chosen in SQL from `auth_users`, never a request field or Party role. Existing atomic M03 creation trigger executes during that INSERT, so revocation, source snapshot CAS, inactive cleanup, compaction, source-ID issuance, append and intent stamp are one SQLite statement. No JavaScript-side auth preflight may authorize a later blind mutation.

A test-only DDL overlay adds a required non-UNAUTHORIZED actor field to the `synthetic_m03_master_intents` receipt and rejects the unguarded M03 creator in this test environment. It reuses the existing nondeployable M04 auth migration and M03 trigger schema, rather than introducing a third production migration. Per-request bearer is hashed from **32 raw hex-decoded bytes** as M04 login does. `nowMs` must come from a trusted server caller, not a browser value. The test-only Worker has immutable routes and ignores client body.

The same permission predicate is required for **readback/replay** and before scanning source records (to prevent category-name probing). The current user must be Modern, Active, version-matched; the session must be nonrevoked, nonexpired, within the 30-minute inactivity interval. Administrator gets intrinsic grant only with NULL role epoch. Other staff require an active role and current role epoch, bounded valid JSON and literal boolean `products.add = true`. An operation created by a different actor is not returned or replayed, even if the other actor now has permission. Changed normalized name for the same operation ID is a conflict; unknown result must be reconciled by the same ID.

## Required acceptance
- Real Node SQLite and local Workerd/D1: Administrator and explicit staff grant create PCAT/PUNT; original source-format result and high-water IDs.
- Deny missing/false/string permissions, malformed JSON, revoked/idle/expired sessions, role/user inactive, credential/user/role epoch mismatch; no changed catalog/receipts/counters.
- Same actor stable replay after simulated lost HTTP response; distinct actor with same operation ID cannot read or replay it. Changed intent refuses without mutation.
- Concurrent revocation/write serializes at INSERT; stale catalog snapshot and forced late catalog failure roll back all effects.
- Public Worker and RPC remain unchanged, /api/rpc still 501, test-only D1 never deployed. No actual staff provisioning, data import or production D1 migration.

## Non-goals / release gates
No `products.edit` status mutation wiring, no public handler, no staging/production D1 writes or schema migration, no stock/Party/Cash/Bank/ledger changes. This proof is not production-ready authorization. The one-business-per-D1 assumption and M02 import floors still require cutover approval. Keep PARALLEL-MODULE-READY blocked.

## Rollback
Revert the isolated PR. Previous synthetic M03 master proof stays green and no deployed D1 state changes.
