# M04/M09 — Authenticated Reports bootstrap, internal D1 contract
**Source:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `Reports.gs::getReportsBootstrap`, `Auth.gs`; current `src/modules/reports-bootstrap-read.js`, `src/db/m04-settings-view.js`; AGENTS.md and WORKSTREAMS.

## Intent and acceptance
- Introduce an internal read-only `createM04AuthorizedReportsBootstrapReader(env).getBootstrap({token, nowMs, today})`.
- **Trust boundary:** `token`, `nowMs`, `today` are supplied by a trusted server adapter in the eventual integration; no untrusted client actor, role, clock or arbitrary SQL allowed.
- Validate exact own-data request shape and canonical 64-character opaque bearer; validate real shop-local YYYY-MM-DD before querying.
- Hash 32 decoded bearer bytes (as M04 session implementation does) using WebCrypto; never query or log the raw token.
- Execute **one D1 SQL read** joining active, nonrevoked, nonexpired, nonidle sessions, modern active staff, current user/credential/role epochs and current literal `reports.view=true` role permission. Administrator is allowed only with its valid administrator session; `allowed_modules` is display metadata, **never** a grant.
- In that same statement, project **only** fixed Settings keys `Shop Name` and `Currency Symbol`. No unguarded secondary Settings query, transaction, money or session heartbeat.
- Reject all unauthorized/malformed results, invalid or accessor-bearing inputs, duplicate unsafe rows and D1 errors without disclosing private Settings. Empty Settings after valid auth uses frozen source defaults.
- Preserve source-proven M09 five-field Reports bootstrap result; report types are isolated each call.
- No public RPC, Worker binding, migration, GAS source, frontend/UI, Party account, Bank/Cash, financial posting or deployment change.

## Superpowers RED → GREEN
1. Commit this plan and an automated missing-module acceptance test first; GitHub Foundation must fail for that precise missing export/module.
2. Add smallest production module with fixed SQL, request guard, one authorization+projection statement and source-tested bootstrap mapping.
3. Add a *separate* test-only real Workerd/D1 integration suite using immutable M04 fixture migration and synthetic M02 Settings DDL. Test Administrator and genuine reports.view, settings-only denied, add/edit-only denied, display-only allowed_modules denied, revoked/expired/idle/disabled/role-epoch changes denied, malformed permission JSON denied, private secret canary omitted, no writes and no public route.
4. Hook integration file into existing M03 local Workerd CI suite. Run required exact-head GitHub Foundation/source/UI, M03/M04 real D1, M01 Chromium and Cloudflare secret-free PR checks. Never claim green without exact-head evidence.
5. Leave draft PR for owner review. M04 production schema/authoritative staff provisioning, tenant scope, authenticated request clock, public RPC wiring and report-data parity remain separate owner gates.

**File owner:** M04 internal module and tests. The shared `tests/integration/m03-workerd.spec.mjs` gets one test-only import. No shared `src/db/**` changes. Rollback: PR revert, no data migration.
