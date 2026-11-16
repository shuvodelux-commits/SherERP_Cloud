# M04 — Trustworthy source provenance in internal role directory (2026-11-16)

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, the frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `RoleManagement.gs`, and the existing local D1 provenance migration `0004_auth_source_provenance.sql`. No public authorization or remote data.

## Implementation overview (13 sentences)

1. The frozen Roles bootstrap enumerates the source role ID, name, status and creation date as part of source role records.
2. The M04 internal D1 Roles directory preview currently exposes only name and status, with a deliberately `partial:true` marker.
3. The target schema now retains original `source_role_id` and `source_created_at_iso` for roles imported from a reviewed source snapshot.
4. These provenance fields must never be synthesized for D1-native or incompletely imported roles.
5. We will extend only the already-authorized, internal-only partial preview to return the two provenance values when BOTH are stored.
6. A D1-native role or a role with only one provenance field will continue to return name and status without an inferred ID or date.
7. The original role name/status fields, source option arrays and response ordering will remain unchanged.
8. The preview continues to require the existing `roles.view` D1 session gate and its postread authority recheck.
9. No role permission JSON, source credential information, authority epoch or unapproved data will be exposed.
10. A new real disposable Workerd/D1 regression will first demonstrate the absence of the required provenanced role metadata.
11. The test also checks the absence of made-up metadata on D1-native and partially provenanced rows, and verifies a denied caller gains nothing.
12. The minimal implementation will project only the two existing SQL columns and conditionally append them to each role object without introducing new handlers.
13. After a demonstrated RED, we will run the full M04 GREEN suite, reconcile concurrent GitHub changes and require repository CI before owner review and merge.

## Scope and source/data mapping

- **Frozen source:** `legacy/source/RoleManagement.gs:getRolesBootstrap` and `Config.gs:ROLES` values; never change.
- **D1 table:** `auth_roles(role_name,status,source_role_id,source_created_at_iso)`; only disposable test fixture inserts and reads.
- **Implementation:** `src/auth/d1-role-directory.js`, existing `readRoleDirectoryPreviewWithD1`, no new public API.
- **RED test:** `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, existing local-only route `/__m04_test__/role-directory`, authentic D1 sessions and rows.
- **Return shape:** `{authorized:true,partial:true,roles:[{name,status,sourceRoleId?,sourceCreatedAt?}],moduleOptions,deleteWindowOptions}`. Optional fields appear only if both stored; source timestamps remain ISO strings without fabrication.
- **Security:** role RBAC is not Party roles; preserve postread auth recheck. Partial remains `true`; not a complete source Roles bootstrap, not authorization for writes.
- **Excluded:** source GAS/Sheets, remote/staging/production D1, Wrangler, public `/api/rpc`, role mutations, real owner/staff data, secret fields and unrelated workstreams.

## Superpowers TDD acceptance
- [ ] Commit plan and RED test; require exact real Workerd/D1 failure specifically on missing provenance fields.
- [ ] Commit minimal SQL projection and narrow conditional mapping.
- [ ] Confirm all M04 tests and repository-wide CI on fresh exact head.
- [ ] Check parallel changes to affected files, reconcile main safely, leave draft for owner review.
