# M04 — Require source provenance in the atomic offline staff importer

**Date:** 2026-11-16. **Base/dependency:** PR #283, which ports owner-merged #282's real D1 `0004_auth_source_provenance.sql` onto `main` (the original #282 was merged to an already-merged feature branch and is **not on main**). Frozen GAS source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Target: `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`, PRs #278/#279/#281 and #283.

## Source-faithful implementation overview (15 sentences)
1. The original USERS sheet includes independent User ID, Created By, Created At, and Last Login metadata.
2. The original ROLES sheet includes a unique Role ID and Created At metadata.
3. PR #279's local-only importer preserves staff and role IDs and legacy credential verifiers in an atomic D1 batch, but does not yet copy those historical values.
4. PR #281 adds the strict historical snapshot audit, including canonical UTC timestamps and blank never-logged-in Last Login.
5. The original PR #282 supplies four additive nullable D1 source-provenance columns; PR #283 ensures they really land on `main`.
6. The importer must now require a **complete** source snapshot carrying every historical field before it even checks D1 contents.
7. Preserve `Created By` as original descriptive source text without inferring an administrator User ID or Party ID.
8. Preserve source `Created At` and `Last Login` UTC strings exactly, including the empty string for never-logged-in accounts.
9. Reject missing, ambiguous, malformed, accessor or inconsistent role/identity inputs without any D1 operation and without revealing source content.
10. Insert each role's provenance and each user's provenance in the same D1 batch that inserts IDs and protected legacy credentials, never via a second non-atomic update.
11. Preserve the existing SQL-side empty-store claim that forbids concurrent or repeated imports, with all-or-nothing rollback.
12. After insert, verify each stored historical field against its source ID alongside the existing permission and pending-verifier reconciliation, returning only fixed issue codes, row indices and counts.
13. The original source records, the public Worker, frontend, RPC registry, remote D1 and authentic live staff rows are all outside this implementation's write scope.
14. D1-native staff may continue to have NULL historical source columns, but a source-imported row must have complete validated provenance.
15. Even after local tests pass, live import requires separately approved protected source export, source date disambiguation, backup, cutover and credential-retention policy.

## Superpowers RED → GREEN
- **RED:** add `tests/m04-provenance-import-required.test.mjs` that requires imported snapshots without Created By/At/Last Login or role Created At to fail before any SQL. Observe a GitHub CI failure on the missing behavior.
- **GREEN:** minimally adjust `src/auth/d1-offline-staff-import.js` to capture those fields via own-data descriptors; reuse `auditLegacyStaffProvenance`; add provenance values to the existing atomic insert statements and to exact redacted reconciliation.
- **Real local Workerd/D1:** extend `tests/integration/m04-offline-staff-import-workerd.spec.mjs` and `tests/integration/m04-offline-staff-import-race-workerd.spec.mjs` synthetic snapshots; verify stored source metadata, missing/invalid field rejection, rollback, drift and legacy first-login continuity.
- **CI and scope:** preserve the pinned local-only M04 auth Workerd workflow, M02–M03 regression tests, public preview isolation, and unchanged `EXPECTED_REMOTE_MIGRATION_COUNT=2`; no schema/RPC/UI changes in this PR.
- **PR gates:** draft stacked on PR #283 until #283 merges; then retarget to `main`, verify exact-head checks, owner reviews and merges. Do not claim production-ready or merge with an incomplete check.

## File/RPC/table inventory
- Modified: `src/auth/d1-offline-staff-import.js`; synthetic Node acceptance and isolated Workerd integration test files only; this plan.
- Referenced without alteration: `migrations/0004_auth_source_provenance.sql`, original GAS sources, existing offline validator `src/auth/staff-provenance-preflight.js`.
- Written **only in ephemeral local Workerd/D1 tests**: `auth_roles`, `auth_users`, `auth_legacy_credentials` via one atomic `DB.batch`, with four source-provenance columns included.
- No new migration, public RPC, Clerk/login bootstrap route, financial writer, production or remote D1 execution, or source-data upload.

**Owner release boundary:** local synthetic rehearsal only; real protected export remains a separate cutover procedure.
