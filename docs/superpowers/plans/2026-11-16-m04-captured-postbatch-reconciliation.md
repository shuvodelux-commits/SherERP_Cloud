# M04 — Reconcile the captured offline source after D1 batch (2026-11-16)

**Module:** M04 auth/staff import safety only. **Canonical repository:** `shuvodelux-commits/SherERP_Cloud` `main`; current source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Read target `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md`. **Prior work:** merged #285, #289, #290 and #291; incompatible #280 closed unmerged.

## Implementation overview (15 sentences)
1. The M04 private offline importer captures a complete validated USERS and ROLES source snapshot before any D1 operation.
2. The original source includes staff IDs, phone numbers, salted legacy verifiers, role permissions and historical Created By/At and Last Login values.
3. The importer executes a clean-store SQL claim and every staff, role, provenance and verifier insertion in one atomic local D1 batch.
4. After the batch it calls a redacted per-row reconciliation helper to check the newly written source identity and credentials.
5. Its current call passes the original caller-controlled source object into that final reconciliation.
6. The reconciliation helper therefore captures a second view of source values after multiple awaited database operations.
7. A caller could change a source field during the awaited batch, although the importer correctly inserted the original already-captured values.
8. The final readback can then report a mismatch **after successful atomic commit**, confusing the operator about whether staff rows exist.
9. The fix must reconcile the same validated captured source values used to construct the SQL batch.
10. It must not weaken source schema preflight, permission checks, UTC provenance, or source-ID matching.
11. It must retain the existing DB-enforced empty-store claim, atomicity, exact readback, secret redaction and one-shot semantics.
12. Add a real isolated Workerd D1 regression where the test adapter changes the original synthetic source only after the SQL batch commits.
13. The post-commit source mutation must not change the imported D1 data or make successful reconciliation incorrectly fail.
14. All unchanged M04 race, rollback, first-login upgrade and browser/Party/finance suites must keep passing.
15. No remote D1, live protected export, public authentication, Worker route, SQL migration, source GAS change or production cutover is permitted.

## Superpowers RED → GREEN and acceptance
1. **RED:** add a real Workerd D1 test to `tests/integration/m04-offline-staff-import-race-workerd.spec.mjs`. Arrange its own empty D1 following the existing race test, intercept `DB.batch`, alter the *caller-owned* synthetic Created By after successful commit, and require the importer to return successful exact readback against its captured original. Confirm the expected failure on GitHub Actions.
2. **GREEN:** change only the final call in `src/auth/d1-offline-staff-import.js` from `reconcileLegacyStaffSnapshotWithD1(db,source)` to `reconcileLegacyStaffSnapshotWithD1(db,{users,roles})`; use the arrays already held by the importer, no second source capture after await.
3. **VERIFY:** check exact-head GitHub Actions, including existing M04 real D1 and cross-module CI. Keep review/merge on `main` until all 14 checks green.
4. **BOUNDARY:** no import into real source/staging/prod, no SQL schema, no RPC, no UI, no new dependency, no Cloudflare authorization.

## File/RPC/table impact
- Change: one existing private JS importer and one synthetic local-Workerd race-test file; this plan.
- Local D1 fake binding: `auth_users`, `auth_roles`, `auth_legacy_credentials` with same atomic statements and exact provenance.
- Public RPC names, `src/index.js`, `src/rpc/registry.js`, source GAS and all migrations: **unchanged**.
- Note: if a genuine D1 integrity mismatch happens after batch commit, this one-line fix does not claim to roll back that committed batch; such cases remain fail-closed and need a separate documented recovery process.
