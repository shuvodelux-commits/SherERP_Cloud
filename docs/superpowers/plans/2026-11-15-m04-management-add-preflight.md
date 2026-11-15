# M04 — D1 staff management CREATE RBAC preflight (internal only)

Date: 2026-11-15
Workstream: M04 Authentication and authorization.
Pinned source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
Depends on merged PR #260 for D1 authorization preflight pattern.

## Frozen GAS behavior
- `UserManagement.gs::createUser(token,payload)` calls `requirePermission_(token,'users','add')`.
- `RoleManagement.gs::addRole(token,payload)` calls `requirePermission_(token,'roles','add')`.
- These are independent permissions; view/edit/delete on users or roles cannot grant add. Active Administrators are eligible for both; custom roles require D1-stored literal `add:true`. The original UserManagement method also forbids non-administrators from creating Administrator accounts; the actual createUser handler will need this and input/uniqueness checks at the SQL write boundary.

## TDD / affected contracts
1. Add real local Workerd/D1 acceptance test for an **absent** internal-only `/__m04_test__/add-preflight` endpoint. Assert exact `createUser` and `addRole` method names, Administrator eligible for both, `users.add`-only role eligible for `createUser` but not `addRole`, and `roles.add`-only role eligible for `addRole` but not `createUser`. Test view-only, edit-only, management-delete-only, unknown/prototype method names, fake browser actor/permissions/payload, malformed token, idle/revoked user, changed role permissions, disabled/reenabled role, no user/role rows created, and no private credential/metadata leakage.
2. Commit test before implementation, verify expected 404 **RED** in GitHub's M04 real Workerd/D1 suite.
3. Add `src/auth/d1-management-add-preflight.js::previewManagementAddWithD1(db,{token,methodName,nowMs})`. Exact two-method allowlist, `validateSessionWithD1` and `tokenFingerprint`; re-query active user, live role status and session role/user/credential epochs using D1. Parse current stored role permissions through reviewed `roleMetadata`. Require exact `add:true` for corresponding module. Return `{eligible:false}` or `{eligible:true,actor:{id,role}}`; no other payload. This is only a **nonbinding** eligibility preview, not a dispatch contract or authorization to create data.
4. Wire a route only in `tests/fixtures/m04-auth-worker.mjs` (nondeployable test Worker). Run full current-head CI, link real RED/GREEN evidence in new draft PR; owner review before merge.

## Boundaries
No production `src/index.js`, public RPC registry or handler, `src/db/**` / SQL migrations (exclusive M03), Cloudflare preview auth, legacy GAS/UI, real credentials, D1 remote writes or financial operations. Real future user and role creation must enforce target-specific Administrator restriction, role assignment validity, password policy, uniqueness, source IDs and SQL-atomic permission/authority checks, with tests and owner approval. KISS: four files only.
