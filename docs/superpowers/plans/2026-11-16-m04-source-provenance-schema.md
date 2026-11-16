# M04 — Staff/Role source provenance D1 schema (2026-11-16)

Source: frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/Config.gs`, `UserManagement.gs`, `RoleManagement.gs`, `Auth.gs`, target `AGENTS.md`, M04 auth source contract and M02/M03 shared D1 migration rules.

## 15-sentence overview and implementation boundary
1. The frozen USERS sheet includes User ID, Created By, Created At and Last Login, whereas the original ROLES sheet includes Role ID and Created At.
2. The currently deployed versioned local D1 auth migration 0003 preserves User ID and Role ID but lacks those four provenance fields.
3. The existing offline import PR #279 is **not** authorized for real customer/staff cutover while these fields are missing.
4. This slice introduces a separately numbered `0004_auth_staff_provenance.sql` D1 migration only after source review.
5. It stores staff provenance in an independent, strict `auth_user_source_provenance` table keyed to the original staff ID.
6. It stores role provenance in a separate strict `auth_role_source_provenance` table keyed to the immutable original source Role ID.
7. It never combines staff roles with Party identity or customer/supplier/vendor balances.
8. Original Created By is stored as source-owned text, not automatically resolved to a Party or another user.
9. Source dates are represented as canonical UTC ISO strings, with explicitly nullable Last Login for the original empty source value.
10. The importer that will later write this schema must preserve the original date instants and reject ambiguous serial dates rather than guessing.
11. SQL constraints reject malformed dates and orphaned provenance records.
12. SQL triggers refuse provenance deletion, mutation and identity replacement to guard source history against accidental rewrite.
13. All tests use synthetic IDs/names/timestamps and isolated local Workerd/D1 with a fake database UUID.
14. The existing staging remote-apply gate remains locked to the owner-approved two core migrations, despite four local schemas.
15. This PR is a schema and safety-proof prerequisite only: no real staff import, no public RPC activation, no Cloudflare remote D1 writes, and no financial activity.

## Superpowers TDD
- RED: write `tests/m04-staff-provenance-schema.test.mjs` first, demanding source columns and migration 0004; confirm an expected GitHub Foundation failure.
- GREEN: write `migrations/0004_auth_staff_provenance.sql` with FKs and immutable provenance protections. Update test expectations for four versioned local migrations without relaxing remote migration approval.
- Real D1: new `tests/integration/m04-staff-provenance-workerd.spec.mjs`, run in existing M04 local Workerd CI, verify valid source metadata, bad date rejection, orphan denial, UPDATE/DELETE/REPLACE denial and no unintended staff-login side effects.
- Cross-module CI: ensure M02 Party, M03 Worker, M04 authentication, M09 settings, local staging D1 and Chromium tests still pass.
- Review: PR is draft, owner-reviewed, no merge until exact-head checks green and current main reconciled.

## Schema impact
- Add two strict, source-only D1 tables with immutable originals and no passwords, bearer tokens, Party links, SQL financial ledgers or worker bindings.
- Do **not** change `src/index.js`, `src/rpc/registry.js`, `wrangler.preview.jsonc` or existing 0001–0003 migration files.
- Future integration: follow-on importer PR must capture USER Created By/At/Last Login and ROLE Created At, write them in the same atomic batch, and perform exact source reconciliation before any real migration.
