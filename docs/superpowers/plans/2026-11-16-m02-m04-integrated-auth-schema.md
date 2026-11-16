# M02/M03/M04 — deployable auth-schema integration gate (2026-11-16)

**Source:** Mohim_ERP pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Auth.gs`, `Config.gs`, `RoleManagement.gs`, `UserManagement.gs`, target `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007.

## Overview / scope (owner-directed)

1. The migration still has only the seven M02 catalog and Party identity tables in its approved production-tree schema.
2. A reviewed M04 auth SQL **test fixture** exists but has never been applied alongside those M02 tables.
3. This workstream adds a **versioned real D1 auth migration** to the target schema without deploying or populating it.
4. It keeps authentication records distinct from Unified Party identities and from all customer/supplier ledgers.
5. It preserves the source User ID, canonical 11-digit staff mobile, custom role permission JSON and active/inactive states.
6. It accepts modern PBKDF2 credentials only in modern verifier columns and retains legacy hashes in a separately guarded import table.
7. It stores only hashed opaque session tokens and blocks session identity replacement, revocation rollback, and unreviewed physical session deletion.
8. It retains SQL-enforced last-administrator and user/role version invalidation rules.
9. It tests the complete set of catalog, Party and auth tables together in **real local Workerd/D1**.
10. The local test Worker calls the existing server-owned `createD1LegacyAuthRpc` and `handleRpc` opt-in bridge, never unreviewed browser RPC names.
11. Public `src/index.js`, RPC registry and `wrangler.preview.jsonc` remain entirely unchanged and inert.
12. Remote staging's existing two-migration apply approval must not silently escalate to a third, so its manual apply path is guarded.
13. No live staff export, legacy passwords, source Sheets, cash/bank data, staging/production D1 or migration cutover is touched.
14. This PR proves a **first production-schema compatibility slice**, not the 49-group ERP migration, public authentication authorization or release approval.

## Superpowers RED -> GREEN -> review

1. **RED:** add a Node acceptance test demanding the versioned auth migration, reviewed structural safeguards and an explicit remote apply block; run through GitHub PR Foundation CI and record expected failures.
2. **GREEN:** promote vetted local-only auth schema to `migrations/0003_auth_core.sql` with reviewer-oriented provenance; update M02 local test schema expectations from two to three migrations and keep it deterministic.
3. **ISOLATED D1:** add a nondeployable Worker/config and Workerd integration test applying **actual** `migrations/` then exercising source-shaped login, validation, revocation, RBAC denial and last-admin protections on synthetic staff.
4. **GATES:** run `npm test`, local Workerd M03/M04, M02 D1, M01 Chromium, dry-run staging build, and exact-head PR checks. Preserve secret-free Cloudflare branch previews.
5. **REVIEW:** inspect GitHub diff, CI evidence and no public binding/deploy config delta; leave PR draft pending owner review. Start separate following PRs for source staff import and secured public RPC after approval.

## File/contract scope

- SQL: `migrations/0003_auth_core.sql` (five auth tables plus guards and indexes; no cash, bank, stock, customer due or posting writes).
- Real local D1 verification: new `tests/integration/m02-m04-integrated-auth-workerd.spec.mjs`, `tests/fixtures/m02-m04-integrated-auth-worker.mjs` and isolated `wrangler.m02-m04-integrated-auth-test.jsonc`.
- Acceptance and safety: `tests/m02-m04-schema-gate.test.mjs`, `tests/integration/m02-party-workerd.spec.mjs`, `scripts/local-d1-schema-check.mjs`, staging local/remote workflow guards, and M04 integration CI.
- UI RPC: same original `login`, `validateSession`, `logout` response envelopes **in local-only gate**; 501/503 behavior in public Worker remains unchanged.
- Source reproduction: no original code rewrite; auth schema adapted from existing test-only M04 SQL and explicitly promoted only after review.

**Release block:** explicit owner approval, source staff/role provisioning reconciliation, retention/abuse policy and cutover review are still required before real remote D1 apply or publicly enabling any authenticated RPC.
