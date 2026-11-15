# M04 — Trusted partial Roles directory projection (local Workerd/D1 only)

Date: 2026-11-15  
Workstream: M04 authentication/authorization; dependency: merged PR #242  
Source of truth: frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `RoleManagement.gs::getRolesBootstrap` and `Auth.gs::requirePermission_`.

## Scope and source gap
The original `getRolesBootstrap(token)` demands `roles.view` and returns the complete ROLES rows, 21 labeled permission-module options and eight delete-window options. The isolated M04 synthetic `auth_roles` schema has role name/status, allowed module list, permission JSON and authority epoch but **no source Role ID/Created At**, and `STAFF_PERMISSION_MODULES` omits original UI labels. Consequently, implementing the full source response is prohibited until M03's schema owner reconciles those fields and original UI metadata. This PR adds a minimal **partial** internal read model listing `{name,status}` for all D1 staff role rows, active AND inactive, in deterministic order. A built-in Administrator is not an auth_roles row; do not synthesize one.

## Test-first Superpowers implementation
1. Add a failing real local Workerd/D1 test invoking a missing test-only `/__m04_test__/role-directory` endpoint; expect `{authorized:true,partial:true,roles:[{name,status}]}` for a fresh `roles.view` staff token and an active Administrator, deny a `users.view` staff without `roles.view`, revoked/expired/malformed session, browser-forged actor/permissions and authority-version downgrade/reactivation. Include inactive roles and malformed stored role permissions without leaking those fields.
2. Commit test first and confirm RED through M04 GitHub Actions: expected local route 404 for valid request.
3. New `src/auth/d1-role-directory.js` calls merged `authorizeStaffReadWithD1` for **only** `getRolesBootstrap`, reads only `role_name AS name,status` from `auth_roles` (no `SELECT *`), rechecks current D1 authorization after the read, returns strict projection or `{authorized:false}`. Add only a nondeployable M04 test Worker route.
4. Confirm GREEN real Workerd/D1 and full current-head GitHub CI, inspect isolated diff, document test evidence in draft PR; owner reviews before merging.

## Explicit restrictions
- No production D1 schema/migration or M03 `src/db/**`, no real staff/role imports, no client-exposed public `getRolesBootstrap`, no `src/index.js` or RPC registry, no GUI redesign, no financial posting, no Cloudflare binding or remote writes.
- The preview is **not** a complete Roles bootstrap and cannot be treated as authorization for later mutating operations. Two permission checks limit but do not eliminate read-time races. Role relationship identities remain separate from Unified Party roles.
