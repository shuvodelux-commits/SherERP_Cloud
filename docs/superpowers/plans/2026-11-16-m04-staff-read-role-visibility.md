# M04 — Staff-read role visibility integrity (2026-11-16)

> **For agentic workers:** Use Superpowers test-driven-development and verification-before-completion; preserve GitHub branch/PR review and exact CI evidence.

**Goal:** Fail closed at the internal D1 staff-bootstrap read boundary when a role's stored visible modules do not match its source-derived `view===true` permissions.

**Architecture / source:** Follow `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, and frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `RoleManagement.gs` and `Auth.gs`. Source `Allowed Modules` is derived from view grants; `src/auth/d1-legacy-rpc.js` already checks this consistency for login profiles, while the independent staff read gate does not yet do so.

## Scoped implementation overview (13 sentences)

1. M04 must authorize staff bootstrap using a current server-side D1 session rather than browser-supplied role data.
2. The existing `authorizeStaffReadWithD1` already validates the session and checks a current role permission for `getUsersBootstrap` or `getRolesBootstrap`.
3. A locally inconsistent D1 role can currently carry `users.view=true` but omit `users` from `allowed_modules`.
4. The source `RoleManagement.gs` derives allowed navigation modules from `view===true` rights, so this inconsistent row is not a valid source role.
5. M04 login's `sourceProfile` already refuses the same visibility mismatch.
6. We will add a test using a disposable real Workerd/D1 database proving this staff read currently succeeds incorrectly.
7. The test will create synthetic users and two synthetic roles: one inconsistent and one consistent.
8. The inconsistent role's `getUsersBootstrap` preflight must deny even when its permission JSON says `users.view=true`.
9. The consistent role's preflight must still succeed to prevent accidental blanket denial.
10. The smallest implementation will compare the parsed visible modules with modules whose `view` permission is strictly `true` inside `src/auth/d1-staff-read-gate.js`.
11. We will not alter the D1 schema, staff imports, credential persistence, or the existing session authority/version mechanism.
12. Public `src/index.js` and `src/rpc/registry.js` remain unchanged, with no D1 binding in public previews and no deployment or live account migration.
13. A draft PR will contain observed RED and GREEN CI evidence, current-head test results, and the explicit remaining M04 release blockers.

## File, RPC and table impact

- **Plan:** `docs/superpowers/plans/2026-11-16-m04-staff-read-role-visibility.md`.
- **RED test:** append one regression in `tests/integration/m04-auth-workerd.spec.mjs` against local Workerd/D1.
- **GREEN code:** `src/auth/d1-staff-read-gate.js` only.
- **RPCs:** `getUsersBootstrap` / `getRolesBootstrap` **internal authorization preflight only**; no public RPC registration.
- **D1 tables:** READ `auth_users`, `auth_roles`, `auth_sessions`; synthetic test fixtures insert rows in ephemeral local D1. No SQL migrations.
- **Acceptance:** invalid role module visibility is denied; valid role with matching view rights stays authorized; existing session checks and negative security tests pass; public preview remains DB-free.

## Superpowers execution checklist

- [x] Inspect current GitHub source, frozen role contract, PRs, and main head.
- [x] Create isolated M04 branch from exact `main@920a019eaa686e84a308b927510555ee52877475`.
- [ ] Commit regression first, run relevant GitHub Workerd/D1 CI, record expected RED result.
- [ ] Apply minimal visibility guard, rerun relevant CI, record GREEN.
- [ ] Verify all required current-head checks and PR diff, then request review; never auto-merge.
