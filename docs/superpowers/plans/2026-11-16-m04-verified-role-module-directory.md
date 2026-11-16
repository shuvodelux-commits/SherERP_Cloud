# M04 — Verified source-role module names in internal Roles directory

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `RoleManagement.gs:getRolesBootstrap`, and local versioned D1 role provenance. This is a read-only internal preview, not a public RPC or action grant.

## Implementation overview (13 sentences)
1. The original Roles bootstrap returns the source Role ID, Role Name, Allowed Modules, Permissions, Status and Created At.
2. Our internal D1 role directory now exposes verified Role ID and Created At alongside name/status but omits module labels.
3. The existing D1 role row stores `allowed_modules` and `permissions_json`, yet those fields are authorization-sensitive and may be inconsistent.
4. This small step will add only the *display-only module-name list*, never action-level grant settings, to the existing partial directory.
5. A role must have both its original `source_role_id` and `source_created_at_iso` before any source module list can be attributed to it.
6. The row's D1 `allowed_modules` and `permissions_json` must also pass the existing `roleMetadata` parser and `roleNavigationConsistent` validation.
7. Valid zero-module source roles will explicitly return an empty `allowedModules:[]` list.
8. A native role, incomplete provenance, malformed JSON, unsupported module or inconsistent permission map will not receive a claimed source module list.
9. Role names, statuses, complete provenance and both static bootstrap options stay backward-compatible.
10. The existing live D1 `roles.view` check before and after the read will remain mandatory, with no use of caller-provided actor claims.
11. SQL will select only the fields needed for validation, and no raw permissions, epoch or credential field will be returned.
12. We will first prove the missing display field with a failing real Workerd/D1 regression, then make the minimum read-only projection change.
13. GitHub CI on the exact PR head, including M04 and M03, must be green before owner review or merge.

## RED → GREEN verification contract
- **RED:** Extend `tests/integration/m04-provenance-workerd.spec.mjs` on the isolated versioned real-D1 fixture. Existing historical Cashier (valid empty module list) should include `allowedModules:[]`; a synthetic fully provenanced read role with `products` view-true should show exactly `['products']`; invalid/inconsistent source role JSON, native role and incomplete provenance should not expose it.
- **GREEN:** Only `src/auth/d1-role-directory.js` changes, importing strict existing `roleMetadata` and `roleNavigationConsistent`; store no new permission and do not change the D1 schema.
- **Non-goals:** Full source `Permissions` data, action-level role editing, writes, new auth epochs, source import, public `/api/rpc`, original GAS/Sheets, real users and remote/staging/production Cloudflare D1.
- **Merge gate:** Keep `partial:true`, no public route, unchanged `roles.view` guards, exact-head M04 Workerd/D1 test and all relevant repository PR workflows passing, owner review before merge.
