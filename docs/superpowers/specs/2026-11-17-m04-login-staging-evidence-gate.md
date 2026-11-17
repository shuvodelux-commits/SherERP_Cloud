# M04 — Private staging login readiness (read-only evidence gate)

**Date:** 2026-11-17 · **Owner:** M04 #23 · **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` · **Depends on:** #421 passing and separately reviewed/merged.

## Context

The current `src/index.js` is a DB-free public foundation: `login` returns 503 intentionally. PR #421 implements a server-only M04 login-to-app-shell bridge and proves synthetic users in isolated real Workerd/D1, but does **not** provision real staff, apply the M04 schema to remote staging, deploy a private authenticated Worker, or enable public auth. Meanwhile `remote-d1-staging.yml` deliberately caps the approved remote migrations at two, preventing remote `0003_auth_core.sql` and `0004_auth_source_provenance.sql`. M02's original role/staff source data must be frozen twice, reviewed and reconciled before any protected credential import. A passed local fixture must not be interpreted as production-ready login.

## Options

1. Auto-migrate 0003/0004 and deploy public login from this PR: rejected. That would expose unapproved staff-data and session surface, and deploy an incomplete ERP.
2. Record an informal checklist: rejected as too easy to declare complete using green synthetic tests.
3. **Chosen:** a small pure `assessM04LoginStagingEvidence` and offline CLI, accepting only **redacted aggregate** read-only staging observations and documentary human-approved evidence. It validates current preview/staging isolation, remote migration name inventory, M04 auth table names, user/role/admin counts, source freeze hash parity, source row reconciliation and sign-off references. It returns stable blocker codes without ever echoing credentials, table rows, SQL, staff identities, source hashes, or arbitrary input. Even a documentary-green report **never authorizesDeployment**; actual staging verification and owner approval remain external.

## Input contract

`{preview,staging,observed,staffFreeze,approvals}`:
- `preview` and `staging` are the current checked-in Wrangler JSON objects, passed to existing repo guard functions.
- `observed` is **externally collected read-only metadata**, not self-proving: `{databaseId,workerName,releaseSha,migrationNames,authTables,userCount,roleCount,activeAdministratorCount,legacyPendingCount}`. No row exports.
- `staffFreeze`: `{sourceSha,firstSha256,secondSha256,reconciledUserCount,reconciledRoleCount,reconciledActiveAdministratorCount,reconciledLegacyPendingCount}`. All only safe counts and 64-character digest strings. Hashes may appear in private manifest files, never logged.
- `approvals`: `{schemaReviewRef,staffReviewRef,privateDeploymentReviewRef}`, nonempty evidence reference IDs. Strings must match a restricted reference format, not passwords/free text.
- `options`: trusted `{expectedSourceSha,expectedReleaseSha}` provided by operator from reviewed GitHub/current source pins.

## Acceptance

- Block absent, extra, malformed, getter-bearing or secret-containing fields without exceptions or leakage. On unknown input return only stable blockers and `authorizesDeployment:false`.
- Check separate DB-free Worker Preview and exact staging D1 binding via existing `validateCloudflarePreviewConfig` and `validateStagingConfig`; never weaken them or read a remote DB.
- Require the named `0003_auth_core.sql` and `0004_auth_source_provenance.sql` plus existing 0001/0002 among remote reported migrations; do not accept a total migration count as proof.
- Require named `auth_users,auth_roles,auth_sessions,auth_login_throttle,auth_legacy_credentials` schema inventory. Do not treat test-only tables or generic seven-table foundation as authenticated D1.
- Require at least one source-reconciled active Administrator and nonzero staff, successful two-pass source SHA-256 freeze, exact released/source SHA pins and equal staff counts. A count is not proof of personally identified staff.
- Require scoped owner approvals and private Worker identity; never assume a user-supplied approval reference proves real consent.
- Always set `authorizesDeployment:false`, `authorizesStaffImport:false`, `authorizesCutover:false` and clear caution; even documentary-complete status is a request for **independent** verification.
- No remote calls/secrets/logging/staff records, no new migration/deploy, no edits to auth runtime, preview, scripts/guard-remote-staging.mjs, or production business data. PR-only GitHub TDD with passing tests before merge.
