# M04 — Two-pass protected source-freeze audit (2026-11-16)

**Source of truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Config.gs`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`, `AGENTS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`. **Dependency:** #285 port of owner-merged #284's provenance-complete offline importer onto `main`, which is separately under exact-head CI.

## Overview and trade-offs (15 sentences)
1. The original source splits staff identity and legacy salted credentials across USERS and permission grants across ROLES.
2. An isolated import rehearsal already validates source staff IDs, roles, permissions, protected hashes and historical provenance before writing local D1.
3. A single source snapshot can still become stale if staff or roles change during the owner's export/cutover preparations.
4. This work adds a strictly offline, read-only **two-pass source-freeze audit** to compare two independently captured complete source exports.
5. Each input must first pass the existing source staff, role authority and provenance validators, so a stable pair of invalid exports can never pass.
6. Original source USER columns compared are User ID, Full Name, Mobile Number, Password Hash, Password Salt, Role, Status, Created By, Created At and Last Login.
7. Original source ROLE columns compared are Role ID, Role Name, Allowed Modules, Permissions, Status and Created At.
8. Compare the primitive source values exactly, including source phone types, raw Permissions JSON strings and never-logged-in empty Last Login.
9. Require stable row count and row order rather than silently sorting, repairing or linking source records.
10. Reject added, deleted, reordered or changed rows—including changed credential verifier, permissions, status, actor or timestamps—with only fixed issue codes and row indices.
11. Use own-data descriptors for every examined source field so no inherited source value or getter is executed.
12. The report contains only `freezeMatch`, aggregate counts and fixed issue codes/indices: never IDs, names, phones, permission objects, verifiers, salts or timestamp values.
13. This function uses no cryptographic seal, D1, source Sheets API, public RPC, network, filesystem or logging and is not evidence that two exports were independently captured.
14. Actual independent exports, operator review of validation issues, protected files, timestamp conversion, backup and rollback remain an owner-approved future procedure.
15. The work must not modify any deployed Worker, Cloudflare preview, remote D1, finance schema, user creation flow or current PR #285.

## Superpowers RED → GREEN
- **RED:** add `tests/m04-two-pass-source-freeze.test.mjs` importing nonexistent `src/auth/two-pass-source-freeze.js` and assert the complete baseline, changed credentials, changed permissions, timestamp drift, counts, row order and fail-closed getter behavior; observe expected GitHub failure.
- **GREEN:** smallest pure helper calling `auditLegacyStaffProvenance` on each input and exact own-data field comparison; fixed redacted envelope only.
- **VERIFY:** current Foundation Node tests, real local M04 Workerd/D1 regression, M02/M03 and browser CI. No new dependency, Worker binding, migration or RPC.
- **REVIEW:** PR draft stacked on #285, then retarget/reverify after #285 merges. Owner merges only after all exact-head checks are successful.

## File/RPC/table inventory
- Add: `src/auth/two-pass-source-freeze.js`, `tests/m04-two-pass-source-freeze.test.mjs`, this plan.
- Read-only source: frozen GAS files; existing `src/auth/staff-provenance-preflight.js`.
- No modified runtime Worker, shared SQL schema, existing importer, Worker route, RPC allowlist, public assets, financial writer, or remote migration workflow.
- D1 tables and RPC **affected: none**. No private source values in commits or PR logs.

**Release gate:** Freeze audit pass alone is NOT permission to import live staff or enable external auth. Owner-signed protected-export and cutover controls are still missing.
