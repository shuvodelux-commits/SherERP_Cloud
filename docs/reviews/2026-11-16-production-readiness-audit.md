# SherERP Cloud — Evidence-Based Production Readiness Audit (2026-11-16)

**Decision: NOT PRODUCTION READY; NOT PARALLEL-TRANSACTION-MODULE READY.** This is a versioned audit snapshot, **not** a claim that work stopped or an authorization to deploy, import live records, open RPC, or cut over. Recheck all PR statuses and merged `main` before treating this as current.

## Scope, authorities, and verified baseline

- Target: `shuvodelux-commits/SherERP_Cloud`, **main** at `6acb8912b49d0c8b5c29c56b237e3f35d5f34198` (2026-11-16 07:35:55 UTC); merged PR [#292](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/292) has **14/14 successful exact-head checks**.
- Original behavioral authority: frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original GAS/Sheets unmodified. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007 and the protected staff import runbook.
- PR [#293](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/293) remains a **draft**, based on this `main`, at `8c61bafbef9bd82c1e6a5c92590777345f4fa332`: fixes decoded-byte session-token SHA-256 parity between the shared helper and existing D1 login. At audit observation, **13/14 checks successful, one M03 Workerd/D1 read-only adapter job in progress**. Do not merge on stale results.
- PR [#256](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/256) is also open and draft; do not infer its source currency read can be deployed or merged without refreshing from `main`.
- GitHub branches API reports `main.protected=false`. The connected app's branch-protection endpoint returns 403, so **actual branch protection/ruleset configuration needs an owner-side Settings inspection**. No write to protection settings was performed.
- On this `main`, `src/index.js` responds `/api/health` with `status:foundation`, `database:not-connected`; `src/rpc/registry.js` is empty, public `handleRpc(request)` has **no trusted auth adapter**, and unknown RPC returns 501 (login returns explicit 503). The UI's sign-in error is expected safe behavior, not working authentication.
- `wrangler.jsonc` has **no D1 binding**. Workers Builds is the single automatic deployment owner for the DB-free shell; PR validations must not become a second deployment pipeline.
- Four **local-versioned** migrations exist: `0001_core_catalog.sql`, `0002_party_identity.sql`, `0003_auth_core.sql`, `0004_auth_source_provenance.sql`. `0001` creates only Settings/Categories/Units; `0002` creates Party identity/roles/legacy links/review only, **not Party accounts or monetary ledgers**. M04 schema includes internal auth tables/provenance. The remote staging migration workflow deliberately stays gated to `EXPECTED_REMOTE_MIGRATION_COUNT=2`: the additional auth migrations are NOT approved for remote application.
- Source inventory covers 49 configured sheet/data groups. The 2026-11-15 async review identifies 394 impacted GAS functions; synthetic Workerd/D1 proof tests are valuable but do **not** establish complete source-to-production runtime parity.

## Blocker matrix — missing acceptance evidence, not an estimate of percent complete

| Gate / scope | Verified progress | Missing proof before gate can pass | Status |
|---|---|---|---|
| M00–M01: source/visual preservation | Pinned source, inert Worker shell; browser/print preservation CI on PR #293 | Authenticated, source-equivalent full browser/POS/print workflows on integrated D1 | PARTIAL |
| M02 / M02-P: schema + data | Core catalog + Party identity in D1, readback/import fixtures, human-review identity constraints | Versioned D1 coverage of **all 49 groups**, separate gross Party accounts, deterministic exact source-ID mapping, deletion/decimal/date parity, snapshot row counts and reconciliation | BLOCKED |
| M03: runtime + posting | Internal async adapters, source graph audit, isolated synthetic D1 atomic mutation tests | Close/verify every source async dependency; actual deployable source-shaped repository schema; global ID counters, FIFO/ledger SQL guards, offline replay and exactly-once posting against integrated schema | BLOCKED |
| M04: security + auth | Local-only persisted D1 users/roles/sessions, offline staff/role import + freeze/reconciliation tests, reviewed SHA-256 parity fix in draft #293 | Complete #293 CI+merge review; protected independent source exports; expiry/idle policy for legacy `Never` sessions, authorized staging migration, end-to-end public RPC permission allowlist tests before deliberate activation | BLOCKED |
| Shared financial kernel; M05–M08 | Isolated synthetic sales/purchases/returns/finance Workerd/D1 tests and source-shaped proposals exist | One reviewed schema/posting owner, **real integrated D1** atomic ledger/stock/cash/Party posting and reversal parity; concurrency/failure tests, complete sale/purchase/return flows and role-separated obligations | BLOCKED |
| M09: reporting/settings/UI | Isolated read/authorization and source-shaped settings proofs; original frontend retained | Complete financial source-data parity plus E2E settings/report/printing checks on integrated staging D1 | BLOCKED |
| CI/deployment controls | GitHub checks and Worker Builds preview; no public Preview DB | Owner-verified **main branch protection** requiring appropriate passing checks and review, safe remote migration workflow with backups/restore, no-secrets preview isolation invariant | BLOCKED |
| M10: full rehearsal | Plans, read-only synthetic fixtures and audit checklists | Owner-approved private full source export; full 49-group snapshot import; zero unexplained stock/ledger/account discrepancies; security/performance/restore drill and sign-off | NOT STARTED AS FULL REHEARSAL |
| M11: cutover/rollback | Draft runbook only | Explicit owner approvals, write-freeze, final checksummed import, production traffic+**new-write** rollback/replay, operational monitoring and handover | NOT APPROVED |

## Exact next execution sequence

1. **M04 PR #293 quality gate (immediate):** wait for exact commit `8c61baf...` to show **all 14 checks successful**; review the source-digest regression and local Workerd persisted-session evidence; then request owner merge. Do not mark GREEN on 13/14 or auto-merge.
2. **Repository control gate:** owner enables a `main` branch ruleset/protection requiring review and passing CI checks (including relevant Workerd/D1 and source checks). Verify settings afterward; a green Preview build alone is not a merge gate.
3. **Single-owner M02/M03 integration increment:** first create a reviewed source-group-to-table/ID/account/async/RPC coverage matrix, listing all 49 groups and 394 affected functions as `ported/tested`, `proposed`, or `missing`. No migrations to remote D1. Then implement **one source-backed read/write vertical slice** using Superpowers RED→GREEN and real local Workerd/D1, with exact source-ID/row reconciliation. Do not open many shared financial SQL writers.
4. **M04 authorization integration only after reviewed M03 boundary:** define source-compatible login/restore/logout and staff permissions, session expiry policy, SQL-validated actor, disable/revoke, last-admin protection, negative RPC security tests, and server-side input allowlist. Public auth remains disabled until independently approved.
5. **M05→M06→M07/M08→M09:** incrementally integrate inventory/FIFO, atomic POS/split payments, returns/exact reversal and cash/finance/ledgers using the single posting owner. Preserve separate Party gross balances, never auto-net. M08-S manual cross-role settlement stays off unless separately approved.
6. **M10/M11:** finish private source-safe import rehearsal, full accounting/source parity, error-injected recovery, performance/security evidence; obtain written owner go/no-go before production migration, auth activation, source write-freeze or traffic cutover.

## Merge/implementation controls

Every coding PR is GitHub-first, scoped to one objective and follows Superpowers plan → **failing acceptance test (RED)** → smallest implementation (GREEN) → affected real Workerd/D1 tests + required full CI → review → owner merge. Documentation-only audit edits are exempt from artificial RED. Use Remote Desktop Commander **only** for genuinely local-PC tasks. Preserve frontend and original source. Do not put real staff, source credentials, phone numbers, hashes, salts, bearer tokens, account balances or private export contents in the repository, GitHub logs, PRs or chat.

**Release boundary unchanged:** no production D1 binding, no public auth/RPC activation, no remote 0003/0004 migrations, no financial cutover and no original GAS/Sheets mutation are authorized by this audit.
