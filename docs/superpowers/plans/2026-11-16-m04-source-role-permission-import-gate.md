# M04 — Source RBAC import authorization gate (2026-11-16)

**Scope:** Preserve frozen Mohim_ERP source role grants before any D1 staff import. Independent of pending #277 authentication migration; no schema ownership, no staging or production writes.

## Source-faithful overview

1. Source `RoleManagement.gs` stores exact Role ID, Role Name, comma-separated Allowed Modules and JSON Permissions.
2. Source `sanitizePermissions_` builds Allowed Modules only from permissions with `view === true`.
3. The current `auditLegacyStaffImport` validates presence and basic JSON shape but does not validate authorization values or this correspondence.
4. An apparently valid snapshot can therefore grant access different from what its allowed-modules field claims.
5. The existing `roleMetadata` parser in `src/auth/d1-legacy-rpc.js` implements the supported module/actions vocabulary.
6. This scope reuses both helpers without creating new permission vocabularies or expanding privileges.
7. Every custom role must have source-safe canonical Role Name and an exact set of Allowed Modules equal to its explicitly enabled `view` permissions.
8. Unknown module names, malformed grant types and invalid delete/backdate windows are rejected before import.
9. Original users and role records, IDs, hashes, salts and mobile numbers are never returned or logged.
10. The report exposes only `preflightPass`, aggregate counts and fixed issue codes with source row indices.
11. Malformed, accessor and proxy rows must fail closed without invoking untrusted property getters.
12. An Administrator-only roster remains valid with zero custom roles, matching the original built-in Administrator model.
13. Public Worker, `/api/rpc`, original UI, D1 schemas and manual staging controls remain untouched.
14. A future separately approved importer must require both this gate and existing structural audit before any write, then perform exact D1 reconciliation.
15. This PR is not permission to migrate live staff data, change roles, enable user login or deploy an authenticated ERP.

## TDD plan

- **RED:** add `tests/m04-source-role-permission-import-gate.test.mjs` exercising one valid source snapshot and invalid grant/mismatch cases. Verify GitHub Foundation CI fails for the absent module.
- **GREEN:** implement `src/auth/source-role-permission-import-gate.js` with only imported existing validators and a tiny fixed error-code projection.
- **VERIFY:** rerun `npm test`, frozen source verification, existing M04 auth Workerd suites and all PR-head checks. Track detailed RED/GREEN Actions URLs.
- **REVIEW:** one scoped draft PR against `main`; no commit to source repo, financial writers or publicly deployed Worker. No merge without owner approval.

## File contract
- Add one pure `src/auth/source-role-permission-import-gate.js`.
- Add one unit acceptance test.
- Add this plan.
- No import/export with live sensitive data and no D1 connections.
