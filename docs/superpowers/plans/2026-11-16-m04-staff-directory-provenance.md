# M04 — Verified staff Users directory source provenance (2026-11-16)

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `UserManagement.gs:getUsersBootstrap`, and reviewed D1 versioned migrations `0003_auth_core.sql` and `0004_auth_source_provenance.sql`. This is an internal nondeployable partial read preview only.

## Superpowers 13-sentence implementation overview
1. The original Users bootstrap returns each user's id, name, mobile, role, status, createdBy, createdAt, and lastLogin.
2. The existing M04 staff-directory preview exposes only its first five columns and truthfully marks itself `partial:true`.
3. The versioned local D1 schema now stores immutable source provenance `source_created_by`, `source_created_at_iso`, and `source_last_login_iso`.
4. The original source's empty `Last Login` value means never logged in, while D1 NULL means not provenanced.
5. We will extend only the existing internal `readStaffDirectoryPreviewWithD1` function to read those three columns.
6. The response will append `createdBy`, `createdAt`, and `lastLogin` only when all three provenance values are stored as strings.
7. Empty-string Last Login will be returned exactly without synthesizing a timestamp.
8. Native and incomplete-provenance staff will keep their original five-field partial projections without invented historical values.
9. The current `users.view` D1 pre-read and post-read authority checks will remain mandatory.
10. The query must stay column-allowlisted and must never expose credential hashes, salts, auth epochs, tokens, or role permissions.
11. A new real, isolated Workerd/D1 regression will first fail specifically on the absent source metadata fields, not because of missing SQL schema.
12. We will then apply the smallest projection change and align only the nondeployable auth-only fixture's nullable columns to keep its unrelated tests valid.
13. GitHub Actions must prove the full M04 suite and repository checks on the same commit before this draft PR becomes review-ready.

## TDD and impact contract
- **RED:** `tests/integration/m04-provenance-workerd.spec.mjs` runs with `wrangler.m04-provenance-test.jsonc`, whose isolated local D1 applies the real versioned migrations (including `0004_auth_source_provenance.sql`). It asserts two complete source users (blank and nonblank Last Login), one incomplete source record and one native D1 record, unauthorized bearer denial and credential exclusion.
- **GREEN implementation:** `src/auth/d1-staff-directory.js`, exact source columns, complete-triple conditional projection, no new API.
- **Fixture compatibility:** `tests/fixtures/m04-auth-migrations/0001_auth_core.sql` gets three nullable matching source columns, so the older real-Workerd auth-only suite still returns exactly five keys for all its unprovenanced fixture records. No versioned migration changes.
- **All tests:** M04 full workflow, M03 Worker-runtime integration and repository PR CI on exact head; review/merge after owner approval.
- **Excluded:** any original GAS/Sheets change, offline import, public `/api/rpc` binding, real staff or secrets, production/staging/remote D1, Cloudflare deployment and staff mutations.
- **Data contract:** Existing response remains `{authorized:true,partial:true,users:[...],roles:[...]}`. Provenanced user adds only `{createdBy,createdAt,lastLogin}` in that order; no inferred values or permission grants.
