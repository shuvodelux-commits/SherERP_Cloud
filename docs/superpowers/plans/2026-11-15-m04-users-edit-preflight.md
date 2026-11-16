# M04 — Users.edit nonbinding D1 eligibility for staff management

Date: 2026-11-15
Source: pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`
Lane: M04 authentication and authorization, depends on merged PR #266.

## Exact original contract
`UserManagement.gs::updateUser(token,userId,payload)`, `resetPassword(token,userId,newPassword)` and `setUserStatus(token,userId,status)` each start with `requirePermission_(token,'users','edit')`. The permission is independent of `users.view`, `users.add` and `users.delete`; a current, active D1 Administrator qualifies. Original methods also enforce additional target-specific constraints including last active Administrator protection and elevated permissions for resetting an Administrator's password. This preflight DOES NOT claim those requirements are satisfied.

## Superpowers test-first plan
1. Extend the *real local Workerd/D1* integration test fixture with one new synthetic UsersEditor identity (not previously disabled by other tests). Add tests against a missing `/__m04_test__/users-edit-preflight` route: active Administrator and UsersEditor with literal stored `users.edit:true` are eligible for all **three exact names**; add-only/delete-only/view-only staff denied, unknown names/prototype strings denied, fake client actor/permissions/target/payload claims ignored; bad/expired/revoked bearer denied. Stored permission removal invalidates already-issued token even when restored, and role deactivation/reactivation cannot resurrect old token. Invalid role permission JSON must fail closed. Ensure no SQL user/profile/credential records were modified by the preview and no sensitive fields leaked.
2. Commit the test alone and verify the expected real Workerd/D1 **RED** endpoint absence (404) in GitHub Actions, resolving fixture contamination before writing production implementation.
3. Minimal internal `src/auth/d1-management-users-edit-preflight.js::previewUsersEditWithD1(db,{token,methodName,nowMs})`: exact allowlist of `updateUser`, `resetPassword`, `setUserStatus`; fresh D1 `validateSessionWithD1`, trusted bearer fingerprint, joined current session/user/role epochs/status, parsed stored `roleMetadata`, literal `users.edit===true` or current active Administrator. Return only `{eligible:false}` or `{eligible:true,actor:{id,role}}`. No target ID accepted.
4. Wire a route only in nondeployable `tests/fixtures/m04-auth-worker.mjs`, then prove GREEN in M04 Workerd/D1, Foundation, safety and remaining GitHub checks; record evidence and diff in a draft PR for owner approval.

## Hard security and file-ownership boundaries
This is nonbinding **read-time eligibility**, never real permission to update staff accounts or passwords. Future real writes require atomic SQL actor/session/permission checks; role assignment rules, password policy, last-admin protection, credential/session revocation and target-specific administrator reset rules. M03 exclusively owns migrations, `src/db/**`, posting kernel. No production `src/index.js`, `src/rpc/**`, Cloudflare D1 binding, public auth, UI/GAS source or live record changes. Exactly plan + new auth module + test Worker + M04 integration test, KISS, no dependency additions.
