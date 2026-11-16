# M04 — Freeze-gated synthetic offline staff D1 import rehearsal (2026-11-16)

**Scope:** M04 only, private/synthetic local Workerd D1. **Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Config.gs`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`), target `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md`, `src/auth/two-pass-source-freeze.js`, `src/auth/d1-offline-staff-import.js`.

## Design overview (15 sentences)
1. PR #285 landed the owner-reviewed one-shot offline importer and original provenance in `main`.
2. PR #289 landed the strict read-only two-pass source-freeze audit in `main`.
3. They remain separate helpers, so a caller can currently invoke the one-shot importer without checking that two source snapshots agree.
4. This PR adds a narrowly scoped **new offline rehearsal entrypoint** rather than changing public authentication or deleting the original internal regression API.
5. The entrypoint accepts two caller-supplied full USERS/ROLES snapshots and one privately owned D1 binding.
6. Identical object references must fail even if their data is well formed, because they do not represent separate caller-supplied snapshots.
7. A complete, own-property-only capture of each source occurs synchronously before any D1 operation.
8. The existing M04 strict role-permission, staff identity and canonical UTC provenance validators run through the frozen capture path.
9. The existing two-pass freeze audit then rejects changed staff/role IDs, row order/counts, permissions, verifiers, phone types, statuses and original history.
10. A failure must make **zero** D1 prepare or batch calls and return only a fixed rejected error.
11. On success the entrypoint passes the **captured** first snapshot to the existing importer, not the caller's mutable original object.
12. The existing importer retains its SQL-side clean-store race claim and one atomic D1 batch for roles, users, legacy verifier and historical provenance.
13. The existing exact redacted reconciliation and credential upgrade semantics remain unchanged, and real Workerd tests exercise the new entrypoint.
14. This validates only the *supplied values* and cannot attest that the two snapshots were independently obtained or that production writes were frozen.
15. No source Sheets data, live credentials, Cloudflare remote D1, public RPC, production login, backend schema or finance transaction will be accessed or changed.

## Superpowers RED → GREEN
- RED: add Node acceptance test `tests/m04-freeze-gated-import.test.mjs` requiring new `rehearseFrozenLegacyStaffImportWithD1` export; confirm intended RED on GitHub Actions.
- GREEN: add a minimal wrapper in `src/auth/d1-offline-staff-import.js` reusing `captureVerifiedSnapshot`, `auditStableLegacyStaffFreeze` and `importLegacyStaffSnapshotWithD1`. Fail before D1 on any invalid/mismatched/aliased source.
- Integration: expand `tests/integration/m04-offline-staff-import-workerd.spec.mjs`: real isolated D1 accepts matching complete clones and reconciles original source provenance exactly, rejects changed and aliased snapshot pairs, injected rollback and concurrency unchanged.
- Verify 14/14 exact-head checks, no changes to `src/index.js`, public `src/rpc/registry.js`, Wrangler preview, migrations or remote staging gate.
- Owner reviews then merges PR to `main`, with nondeployable synthetic only scope. The owner-approved export/backup/cutover procedure remains **not executed or authorized**.

## File/RPC/table impact
- Change `src/auth/d1-offline-staff-import.js`, Node test, one local Workerd/D1 integration test and this plan.
- D1 tables touched *only in existing synthetic test database*: `auth_users`, `auth_roles`, `auth_legacy_credentials` (one DB.batch).
- No new migration, public RPC, source GAS write, production or remote D1 apply, preview binding, secrets, authentic credentials or Party/financial schema.
