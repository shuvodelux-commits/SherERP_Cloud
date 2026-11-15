# M04 — Trusted management-delete RBAC preflight (internal only)

Date: 2026-11-15
Workstream: M04 authentication/authorization, source SHA `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
Depends on merged PR #253; no public authentication release approved.

## Source contract
- `UserManagement.gs::deleteUser` calls `requireManagementDeletePermission_(token,'users')`; `RoleManagement.gs::deleteRole` calls `requireManagementDeletePermission_(token,'roles')`.
- `Auth.gs::requireManagementDeletePermission_` permits active Administrator or an active custom-role member whose stored `users.delete` or `roles.delete` is granted. Legacy source accepts boolean `true` or the historic `unlimited` alias. M04 normalized/stored `RoleManagement.gs::sanitizePermissions_` maps the alias to **boolean true** for management modules, and the reviewed D1 role metadata validator requires management delete to be Boolean. Do not treat edit/view/add or date-window codes as delete rights.
- The original actual delete methods also require actor/target safeguards: self-delete prohibited; final active Administrator cannot be deleted; assigned roles cannot be deleted. These are NOT implemented by this preflight.

## Plan / acceptance
1. Write RED real local Workerd/D1 tests for a synthetic internal `/__m04_test__/delete-preflight` route. Require active Administrator to pass both method names; custom source role with `users.delete:true` but `roles.delete:false` passes only `deleteUser`; custom role with `roles.delete:true` but `users.delete:false` passes only `deleteRole`. Deny unknown method names including prototype/property tricks, malformed bearer, expired/idle sessions, browser-claimed actor/rights, revoked tokens, inactive users, stale sessions on role permission edit and role disable/re-enable. Fail closed on invalid stored role permissions. Ensure no staff records are deleted and no credential material appears in outputs.
2. Confirm GitHub M04 real D1 RED failure: missing test-only route returns 404.
3. Add `src/auth/d1-management-delete-preflight.js::previewManagementDeleteWithD1(db,{token,methodName,nowMs})`, method allowlist derived only from **exact** two source RPC names, requiring the existing trusted D1 session validator, and rechecking bearer fingerprint, active user/role authority epochs and stored validated role metadata in a joined D1 SELECT. Require literal `delete:true` for the exact matching staff management module, or current D1 Administrator. Return only `{eligible:boolean,actor?:{id,role}}` with no target identifiers or role metadata. The word **eligible** deliberately indicates **nonbinding preview**.
4. Wire only the **nondeployable synthetic M04 Workerd fixture** endpoint; leave the production Worker registry empty and the original public `deleteUser`/`deleteRole` RPCs disabled. Verify full current-head CI and evidence in a draft PR for owner review.

## Mandatory boundaries
- This is **not an authorization to perform deletion** or any financial write. A future real mutation must execute D1-enforced target checks, current authority/version check, last-admin/assigned-role constraints, and session revocation **at the atomic SQL write boundary**; a read-before-write preflight is insufficient due to TOCTOU.
- No `src/index.js`, `src/rpc/handler.js`, registry, `src/db/**`, migrations, real staff records, production D1/Cloudflare bindings, UI/GAS, transaction kernel, Party roles or financial code touched. M03 retains exclusive schema/posting ownership.
- File inventory: this plan; M04 internal preflight; test-only M04 Worker; real local Workerd/D1 integration test. KISS, no new packages/frameworks.
