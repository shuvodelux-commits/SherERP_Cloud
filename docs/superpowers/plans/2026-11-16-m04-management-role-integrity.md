# M04 — Consistent D1 role navigation metadata across management previews (2026-11-16)

**Contract:** `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`RoleManagement.gs` and `Auth.gs`). **Branch:** `m04/management-role-integrity-20261116`, GitHub-first. **Release:** isolated internal-only M04 review; no live activation.

## Overview (13 sentences)
1. Staff role permissions and allowed navigation modules are distinct but related fields in the legacy source.
2. The source derives allowed navigation modules exclusively from permission entries whose `view` action is exactly `true`.
3. The internal D1 role metadata parser currently verifies known module/action syntax but does not enforce the derived navigation relationship.
4. The source-profile RPC bridge and internal staff read gate already reject inconsistencies in their own local checks.
5. Three management eligibility previews consume the shared parser independently and do not repeat this role integrity rule.
6. A corrupted active role can therefore appear eligible for `users.add`, `users.edit` or `users.delete` despite contradictory navigation metadata.
7. These previews are nonbinding and do not authorize a mutation, but inconsistent outputs can mislead future protected integration.
8. We will reproduce this condition in an isolated real Workerd/D1 test with a synthetic role and an internal core-authenticated token.
9. The regression will exercise create-user, add-role, users-edit and management-delete preflights without performing a write.
10. The test will then correct only `allowed_modules`, obtain a new authority-versioned token and verify the same action grants are still eligible.
11. The production fix will enforce exact view-derived membership once in the shared `roleMetadata` parser, so every consumer fails closed.
12. Valid roles may still hold add, edit or delete privileges without `view` on the same module, as the source actions are independent.
13. We will observe RED then GREEN in GitHub Actions, keep the PR in draft until current-head CI is green, and leave public authentication, remote D1 and financial behavior untouched.

## File / contract inventory
- Plan: this file.
- Test: `tests/integration/m04-legacy-rpc-workerd.spec.mjs` (real local D1, synthetic `auth_roles`, `auth_users`, `auth_sessions`; test-only write).
- Production: `src/auth/d1-legacy-rpc.js::roleMetadata` (return null for a non-Administrator role unless allowed module keys are an exact set of `permissions[module].view === true`).
- Internal callers: `previewManagementAddWithD1` (`createUser`, `addRole`), `previewManagementDeleteWithD1` (`deleteUser`, `deleteRole`), `previewUsersEditWithD1` (`updateUser`, `resetPassword`, `setUserStatus`).
- Scope excludes source GAS/Sheets, migration SQL, public RPC registry, Worker routing, staging/production credentials, role writes and live data.

## Test-first acceptance
- [ ] Commit regression first and observe source-shaped action grants incorrectly eligible from inconsistent role navigation (RED).
- [ ] Apply minimal role parser integrity check (GREEN).
- [ ] Observe real-D1 M04 and repository-wide exact-head CI with zero failures.
- [ ] Confirm main comparison and PR diff are scoped; do not merge without owner review.
