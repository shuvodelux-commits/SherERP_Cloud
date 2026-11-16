# M04 — Strict protected USERS / ROLES source-row contract (2026-11-16)

**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Config.gs`, `Auth.gs`, `UserManagement.gs`, `RoleManagement.gs`. **Base:** `SherERP_Cloud/main@b0219a239fd1ba0e8bff80d22bb84edab3fdd70a`. Follow AGENTS.md, docs/M04_AUTH_SOURCE_CONTRACT.md, docs/MIGRATION_PLAN.md and docs/runbooks/M04_PROTECTED_STAFF_EXPORT_AND_CUTOVER.md.

## Twelve-sentence implementation overview

1. The frozen source defines ten USERS headers and six ROLES headers that are already listed in the protected M04 offline importer.
2. Current import preflight reads the expected fields but silently ignores unexpected fields on the same source row.
3. A future source column or an exporter-injected field could therefore disappear from the imported D1 record without any schema review.
4. This slice rejects any protected source row whose complete set of own keys differs from the frozen headers, before any D1 operation.
5. It rejects unexpected enumerable, non-enumerable, symbol, accessor and inherited fields rather than dereferencing unexpected values.
6. It also rejects non-enumerable required header descriptors so approved JSON-shaped exports retain one inspectable field per source column.
7. A duplicate or missing header, source row order drift and invalid original role/user semantics remain protected by existing preflight logic.
8. The new gate reuses the current captured plain records and preserves supported source integer-format mobile values, canonical historical UTC text and immutable IDs.
9. The two-pass source-freeze gate and the standalone offline import both reuse the same tightened row capture logic.
10. Readback reconciliation uses that same source capture path so it cannot silently certify an export containing unsupported columns.
11. Local Node and isolated Workerd/D1 tests must prove rejects occur before database activity while a valid frozen snapshot still imports and reconciles.
12. No source export, remote migration, public login, RPC registration, Cloudflare binding, schema change or production cutover is authorized by this offline guard.

## Impact / RED → GREEN acceptance

- **Auth change:** `src/auth/d1-offline-staff-import.js`, `captureRows` only; no SQL, session, API or auth-policy change.
- **Tests:** `tests/m04-provenance-import-required.test.mjs` no-D1 access guards; `tests/integration/m04-offline-staff-import-workerd.spec.mjs` actual isolated local D1 zero-write assertions. Existing M04 CI job runs the Workerd suite.
- **No changes:** frozen GAS, frontend, `src/index.js`, `src/rpc/registry.js`, staff/Party/financial D1 migrations, authenticated session/role semantics, Worker Preview or production secrets.
- **TDD:** commit failing tests and verify RED in GitHub Actions; implement minimal strict-row capture; verify GREEN in Node and real Workerd/D1; preserve every other preexisting test and inspect exact-head CI.
- **Owner gate:** protected export, staff credentials and remote D1 still require independent owner approval; PR remains draft until all checks pass and owner reviews.
