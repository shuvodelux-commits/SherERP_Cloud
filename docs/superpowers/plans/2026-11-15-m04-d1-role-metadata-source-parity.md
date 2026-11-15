# M04 — Source-faithful custom-role login metadata and session invalidation

**Date:** 2026-11-15. **Owner:** M04. **Source:** pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen `legacy/source/RoleManagement.gs#sanitizePermissions_`, `Auth.gs#DELETE_WINDOW_OPTIONS` and `UI.gs#PERMISSION_MODULES`. Follow `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md` and Superpowers RED→GREEN. This work is **not** real login activation.

## Bug / security boundary

The merged internal `src/auth/d1-legacy-rpc.js` `roleMetadata` rejects valid original role permission data:
- Native ROLES Permissions JSON includes `backdate`, currently rejected as an unknown action.
- Native delete windows include `disabled` and `same`, currently excluded from the D1 metadata validator.
- For `users` and `roles`, source `sanitizePermissions_` stores boolean management-delete, which the D1 metadata validator rejects.
- The **test-only** D1 `trg_auth_role_version` currently monitors `permissions_json` and status but not `allowed_modules`. Changing role display grants alone should invalidate already-issued authority snapshots.

These discrepancies make legitimate imported Cashier/management roles fail sign-in and may leave UI role projections on existing sessions usable after a metadata change. Client-visible metadata must **never** authorize a server write; D1 checks are independently mandatory.

## Chosen minimal solution

Use the existing allowlisted 21 module names in `d1-legacy-rpc.js`. Extend the supported DELETE window codes to exactly `disabled,same,1,3,7,15,30,unlimited` from pinned `Auth.gs`. Accept `backdate` only with these same windows; for `users`/`roles` allow management `delete` only when boolean, all others require window strings; `view/add/edit` remain strict booleans. Unknown actions, invalid roles or invalid permission JSON fail closed, revoking newly issued sessions. Do not normalize malformed data into new rights or silently strip grants. Preserve source response `{success,data:{token,user,allowedModules,permissions}}` and original role JSON.

In `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` **only**, bump auth role version when `allowed_modules` changes, with no bump for unchanged values. Real `migrations/` are exclusively M03-owned and remain unchanged. M03 must review/preserve the trigger when promoting a final schema.

## TDD / acceptance

1. **RED:** extend `tests/integration/m04-legacy-rpc-workerd.spec.mjs` with synthetic `SourceRole` and real Workerd/D1 login. It must return original Permissions fields with source `same`, `disabled`, `backdate`, and boolean management delete; a change to `allowed_modules` alone must invalidate the old token and increment role `auth_version`; no-op update must not. Invalid management-delete and backdate values still deny login and immediately revoke any session. Capture failing M04 GitHub Workerd/D1 PR job before any production change.
2. **GREEN:** update only `src/auth/d1-legacy-rpc.js` and **test-only** M04 SQL fixture with the above minimal validations and trigger change. No changes to production Worker/registry, public route, real SQL migrations, staff data, frontend, Cloudflare config, workflows or shared DB owner files.
3. Verify M04 GitHub Workerd/D1, full Foundation Node/source, M03 integration, automatic preview and all PR workflows; report numbers from actual logs. Review narrow diff, no secrets.
4. Open PR as draft, record RED/GREEN commits, CI, no public login activation. Do not merge without review.

## Boundaries and next blockers

M04 staff phone/import audit #39/#42/#99 already merged; independent internal RBAC policy draft PR #30 remains a separate review dependency and should not be silently copied/merged. Role metadata is **UI-only**, not an authorization token. Real staff import, M03 auth SQL promotion, first Administrator, last-admin write authorization, protected staging login, and exact-role permission enforcement remain blocked. Public `login` stays HTTP 503 and unsupported business RPC HTTP 501.
