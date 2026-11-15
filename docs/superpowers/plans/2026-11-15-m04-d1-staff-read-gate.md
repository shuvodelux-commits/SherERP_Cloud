# M04 — Trusted D1 staff permissions for two source read-only RPC contracts

Date: 2026-11-15  
Lane: M04-design (auth module and dedicated tests only)  
Frozen source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`)  
Dependency: merged M04 #233; no authenticated public business RPC enabled

## Goal and boundaries
Protect the authorization *preflight* for the source `getUsersBootstrap(token)` and `getRolesBootstrap(token)`. Both are **read-only** source contracts calling `requirePermission_(token, 'users'|'roles', 'view')`. No source module data read/response or live RPC handler is implemented in this slice. These method names are a **closed allowlist**. M03 still exclusively owns production `src/db/**`, database migrations and shared Worker runtime. Source-defined staff roles are distinct from unified Party relationships.

## Smallest design
Add `src/auth/d1-staff-read-gate.js` exporting `authorizeStaffReadWithD1(db,{token,methodName,nowMs})`. The public Worker and `src/rpc/registry.js` must not import it. The trusted function:
1. Rejects any unknown or write-capable method name before touching D1.
2. Uses `validateSessionWithD1` for active, unexpired, idle-time-valid D1 bearer identity; rejects malformed, disabled, revoked, stale-authority sessions.
3. Performs a second source-of-truth D1 SELECT joining the **same token fingerprint** with `auth_users`/`auth_roles`, enforcing active status, expiry, idle and user/role/credential authority epochs. This avoids authorizing from client-submitted `userId`, `allowedModules`, or `permissions` and eliminates trusting a cached permission projection.
4. Validates role metadata with the existing trusted `roleMetadata` parser from `d1-legacy-rpc.js`. For non-admin users, grants only the precise module's literal `view:true` stored in `auth_roles.permissions_json`. Administrator is recognized only after D1 proves an active Administrator session. Return only `{authorized:boolean,actor?:{id,role}}` — never token/phone/password/role data.
5. This checks a **read-only preflight**, not an atomic guarantee for subsequent mutations. It must not be reused as a financial-write gate; real writes require D1-enforced conditional SQL at their commit boundary.

## Superpowers acceptance and evidence
- **RED:** extend existing synthetic M04 Workerd/D1 integration to call a dedicated `/__m04_test__/authorize` fixture endpoint that is initially absent. Require authenticated Admin and source-granted `roles.view` to succeed, but `users.view:false`, unknown methods, fake client actor claims, stale/revoked tokens, role disable and role authority edits to be denied. Capture GitHub M04 CI failure before implementation.
- **GREEN:** add one internal auth module and wire only the test-only M04 Worker route. Minimize shared files. Test permission changes/revocation in actual local Workerd/D1, plus the full source and Cloudflare preview-safety matrix.
- Ensure the deployed Worker still returns 501 for both Users and Roles bootstraps. No user import, management mutations, production D1 migrations, Party/finance changes, or public authentication activation.
- Review all diff files, RED/ GREEN evidence, and CI before owner merge. No automatic merge.

## Audit limitation
An authorization read and a later domain write are not one transaction; even the second D1 SELECT cannot authorize an unrelated later financial mutation. Future per-action RPC integration requires a reviewed method registry with input validation and atomic or version-fenced operation enforcement. Public behavior must remain inert until that separate gate.
