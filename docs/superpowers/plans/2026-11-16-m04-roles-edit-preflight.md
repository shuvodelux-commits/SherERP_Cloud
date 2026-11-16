# M04 — Source-backed internal roles.edit eligibility preflight (2026-11-16)

**Source of truth:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen `RoleManagement.gs`, `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, and `docs/WORKSTREAMS.md`. GitHub-only, Superpowers RED → GREEN, no public activation.

## Implementation overview (13 sentences)
1. The original ERP exposes `updateRole` and `setRoleStatus` through the legacy serverCall contract.
2. Both source functions require the `roles.edit` action before reading or changing a target role.
3. M04 already provides internal-only D1 nonbinding previews for staff reads, user edits, management adds, and management deletes.
4. The two `roles.edit` actions currently have no equivalent internal D1 eligibility preview.
5. A new internal preview will accept only a fixed allowlist of `updateRole` and `setRoleStatus` method names.
6. The preview will obtain the current actor through the D1-backed session validator, never from browser claims.
7. It will recheck the token, active user and role authority epochs, and the existing session-expiration and inactivity bounds in a subsequent D1 permission SELECT.
8. For nonadministrators it will parse persisted role metadata, reject inconsistent view-derived navigation, and require `permissions.roles.edit === true`.
9. The built-in active Administrator will remain eligible according to the existing source authorization policy.
10. Permission checks remain independent, so `roles.add`, `roles.delete`, or `roles.view` alone will not grant `roles.edit`.
11. A real local Workerd/D1 regression will first fail while the test-only route is absent and then pass after the smallest internal implementation is added.
12. The regression will exercise permitted and denied roles, invalid tokens or method names, stale role versions, and a navigation contradiction without writing roles through the preview.
13. No public Worker RPC registry, M02 schema, live staff export, remote D1 database, UI, or financial posting flow will be changed.

## File, RPC and data inventory
- **Source:** `legacy/source/RoleManagement.gs` (read only).
- **RED tests:** `tests/integration/m04-legacy-rpc-workerd.spec.mjs` in existing disposable Wrangler Workerd and D1 fixture, synthetic users/roles only.
- **GREEN source:** `src/auth/d1-management-roles-edit-preflight.js`, patterned on the existing `d1-management-users-edit-preflight.js`.
- **GREEN local fixture:** `tests/fixtures/m04-auth-worker.mjs` adds a test-only `/__m04_test__/roles-edit-preflight` path; never deployed.
- **D1 tables:** `auth_sessions`, `auth_users`, `auth_roles` session/role read; synthetic test creates/edits only local role rows and real hashed sessions.
- **Return contract:** `{eligible:false}` on missing or unauthorized rights; `{eligible:true,actor:{id,role}}` when read-time eligible, never commit authority.
- **No additional package**, migration, deployed route or Worker binding.

## RED → GREEN acceptance and release checklist
- [ ] RED: fail specifically because the local roles.edit preview is missing, with all older M04 tests passing.
- [ ] GREEN: current-token eligible and explicit denial scenarios tested against actual local Workerd/D1.
- [ ] Confirm source contract/permission separation, no role writes in the preview, no client actor trust.
- [ ] Confirm exact-head full GitHub CI, reconcile newer `main` without overwriting parallel modules.
- [ ] Draft PR with evidence, risks and rollback. Do not automatically merge or expose public login.
