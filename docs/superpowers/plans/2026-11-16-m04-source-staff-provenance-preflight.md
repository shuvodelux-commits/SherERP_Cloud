# M04 — Historical staff and role provenance preflight (2026-11-16)

**Source:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Config.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Auth.gs`, target `AGENTS.md`, M04 source contract, ADR-007.

## Source-faithful overview (15 sentences)

1. The source USERS sheet contains Created By, Created At and Last Login fields in addition to staff identity and credentials.
2. The source ROLES sheet contains Created At, distinct from the staff authorization role name and original Role ID.
3. First-run Administrator creation sets Created By to `First-run bootstrap`, Created At to a Date and Last Login to an empty string.
4. Later user creation sets Created By to a source actor's display name or phone rather than an authoritative immutable actor ID.
5. Source login updates Last Login to a Date, so that field may be empty for a user who never signed in.
6. Source RoleManagement writes Created At when creating a custom role.
7. Existing M04 D1 0003 stores user and role identities but cannot yet retain all those historical provenance fields.
8. The already reviewed offline staff importer on PR #279 therefore remains a **synthetic local rehearsal**, not authorization for full production data migration.
9. This slice validates a protected, complete JSON export using canonical ISO-8601 UTC timestamps while leaving original raw values unchanged.
10. A field with a missing or invalid timestamp is quarantined for explicit owner review instead of being silently replaced with today's date.
11. The Created By value is retained as source text and must not be guessed into a User ID or treated as an authorization identity.
12. Invalid Last Login values are rejected but a precisely empty Last Login is allowed for never-logged-in users.
13. Existing M04 structural and role-permission audits must pass before the provenance audit returns a successful report.
14. The result returns only fixed issue codes, source row indices and aggregate counts—never names, phones, password verifiers, Created By strings or timestamp values.
15. This is an independent, pure preflight step: no SQL migration, source-sheet mutation, public RPC, D1 operation or production activation is performed.

## Superpowers TDD and review
- RED: add `tests/m04-staff-provenance-preflight.test.mjs` that imports the missing helper and asserts invalid/missing dates fail closed; collect GitHub CI failure.
- GREEN: implement `src/auth/staff-provenance-preflight.js`, a small pure function on already reviewed source snapshots.
- Verify: Node/CI source suite, exact-head M04 Workerd regression, M02/M03 CI and M01 browser smoke. Keep PR scoped to plan, test and helper only.
- Integration gate: follow-on separately approved `0004` provenance storage migration and exact D1 readback, then require the new preflight before any live-data import.
- Dependency: PR #278 already merged; PR #279 contains the synthetic offline importer and must finish independent CI/review. This PR must not change it or permit real imports.

**Release block:** No private staff data, raw IDs or hashes are committed. No Cloudflare bindings, Workers, local CachyOS or production DB are accessed.
