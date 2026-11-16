# M04 — Offline staff/role D1 import and exact readback rehearsal

**Owner-directed start:** 2026-11-16. **Source authority:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original `Config.gs`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, target `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md` and ADR-007. **Depends on:** PR #278 strict source-role authority preflight; PR #277's migration 0003 is now on `main`.

## Overview, design, and boundaries (15 sentences)
1. The frozen source stores staff under USERS and custom permission roles under ROLES, independently of the seven commercial Party roles.
2. The existing D1 auth schema has User ID, canonical phone, Role Name, immutable original Role ID, and a separate guarded legacy credential table.
3. The current import audit checks complete staff/role snapshots and the pending PR #278 checks that Allowed Modules exactly equal view-enabled permissions.
4. This work adds one internal offline importer using those gates instead of creating another role-permission policy.
5. The caller must supply a complete **trusted, protected** source export, never data fetched from an arbitrary client RPC.
6. Both arrays are captured through own data descriptors before auditing or preparing SQL, rejecting accessor and malformed records.
7. The importer refuses a nonempty D1 authentication store rather than modifying or replacing existing accounts.
8. An offline-imported user begins in `LegacyPending` with an unguessable random modern-verifier placeholder, never with a source SHA-256 hash in the modern password column.
9. The original salted SHA-256 verifier is stored only in `auth_legacy_credentials` and is later upgraded through the existing SQL guarded first-login path.
10. D1 executes the role, user, and legacy credential inserts in one atomic `DB.batch` on real local SQLite/D1.
11. A separate trusted readback compares each role's source ID, name, status, allowed modules and permission JSON, and each user's ID, name, canonical phone, role, status, pending state and source legacy verifier.
12. Only fixed result codes and aggregate counts are returned; no token, source ID, phone, name, hash, salt or full permission object appears in reports or errors.
13. A failed batch must leave no partial identity or secret rows, and a replay must not create a duplicate import.
14. The public Worker, RPC registry, frontend, Cloudflare preview, remote D1, Source Sheets and financial schema remain untouched.
15. Full production import is **blocked** on original USERS Created By/At/Last Login, ROLES Created At provenance storage, protected export authorization, staging backup, retention and cutover review; this PR deliberately does not pretend those omitted source timestamps are preserved.

## Superpowers RED → GREEN sequence
- **RED:** commit a new `tests/m04-offline-staff-d1-import.test.mjs` before its module, and observe missing-module failure in PR CI.
- **GREEN:** implement minimal `src/auth/d1-offline-staff-import.js` exporting `importLegacyStaffSnapshotWithD1` and `reconcileLegacyStaffSnapshotWithD1` with no network/deploy/RPC linkage.
- **WORKERD:** add isolated test Worker/config and `tests/integration/m04-offline-staff-import-workerd.spec.mjs`, then execute it in existing M04 local-only authentication workflow. Test real D1 atomic rollback, empty-only acceptance, exact readback, drift, legacy verifier containment and no public import route.
- **REVERIFY:** exact-head Foundation, M04 Workerd, M02/M03 cross-module CI, staging local and browser checks. Document failing and passing URLs.
- **REVIEW:** draft PR based on `m04/source-role-permission-import-gate-20261116` (#278), not `main`, until #278 merges. Then retarget and reverify. No owner-approved live import or remote D1 writes from this work.

## File/RPC/table impact
- Source: frozen original GAS files read only, no edits.
- Runtime: new offline helper only; no `src/index.js`, RPC allowlist, frontend or authentication route change.
- Schema: reuses approved `migrations/0003_auth_core.sql`; **no** new migration or financial table.
- Local tests: one Node acceptance file, local-only Wrangler config, inert Worker fixture, integration spec, M04 CI file.
- Written tables **only in ephemeral local D1**: `auth_roles`, `auth_users`, `auth_legacy_credentials`. Read-only checks: `auth_sessions`, `auth_login_throttle`.
- Safety: no logs of credentials, no raw record details in CI; no actual export or Cloudflare secrets.

**Release gate:** `LOCAL_REHEARSAL_ONLY`; field provenance gaps and protected-export approval must be closed in separate reviewed PR before any live/staging data import.
