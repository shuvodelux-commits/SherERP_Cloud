# SherERP Cloud — Concurrent Workstream Readiness (2026-11-15)

**Authoritative references:** `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 Unified Party, current M02/M03 PRs.

## Current state: parallel preparation READY; parallel transaction-module coding NOT READY

PR #17 and #18 are merged. Source-shaped catalog reads and importer provenance checks exist, but the M03 async D1 conversion is **not complete** and M04 authenticated RPC gates are not implemented. M02's remote staging migration only established seven tables and two migrations; this is not a complete source-data import or a functioning ERP.

The machine-generated inventory in `docs/baseline/m03-direct-call-inventory.json` is a conservative **direct lexical** source audit. It counts helper invocations and GAS runtime references in all 47 original `.gs` modules; it is **not** the full transitive async caller graph or proof of safe porting. Regenerate by running `node scripts/audit-m03-callers.mjs`, and verify frozen contents with `node scripts/audit-m03-callers.mjs --check`. Review any drift before accepting further module changes.

## Parallel lanes that can be opened now (isolated branches/PRs)

| Lane | Scope / primary owner | Files / protected boundaries | Release effect |
| --- | --- | --- | --- |
| M02-safe | Deterministic catalog/Party export fixture parity and **offline** dry-run importer checks | Own `scripts/dry-run-*`, importer fixtures/tests. No remote D1, no unreviewed financial table DDL | Tests/docs only |
| M03-core | Pinned source async caller graph and reviewed repository adapter design | **Exclusive owner** for `src/db`, migrations, Worker runtime abstraction and SQL transactions. No public RPC until M04 | Internal read-only contracts / tests |
| M04-design | Legacy Auth/User/Role contract and threat-model audit; RED security tests in isolation | Own M04 docs/tests and auth module branch; must not modify shared `src/db` or deploy auth endpoints before M03 integration | Spec/test preparation only |
| M01-UI QA | Preserve original HTML/JS, POS, print and mobile parity with browser snapshots and test plan | Own independent Playwright tests/fixtures, **no UI redesign**, no overlapping `src/rpc` changes | Tests/documents only |

Avoid sharing a working tree. Each lane must start from fresh `origin/main`, use a separate branch/worktree and PR, and have an explicit file owner. Require narrow diffs, baseline tests, original behavior tests, source SHAs and Cloudflare automatic secret-free preview checks. Do not run several migrations or write to the same remote D1 concurrently.

## Required gate before concurrent backend module implementation

Mark **PARALLEL-MODULE-READY** only when ALL are evidenced by merged PRs and local/CI tests:

1. **M02/M02-P:** source master/transaction identities and approved independent Party account directions, schema/import reconciliation and repeatable local D1 imports; do not auto-net Party roles or infer source ID links from names/phones.
2. **M03:** awaited repository methods end-to-end (no leaked Promise), tests for representative real workerd/D1 read + write behavior, and tested atomic SQL posting/idempotency contracts. All remaining GAS-only dependencies inventoried with an owner.
3. **M04:** persistent server-validated login sessions, permission allowlist, actor identity from trusted credentials only, logout/revoke/disabled-account and last-admin tests **against real D1**.
4. **Shared kernel:** single code owner for `src/db`, SQL migrations, invoice/stock IDs, cash-session policy, atomic ledger/stock posting and exactly-once reversal contracts; realistic concurrent/replayed/failure-injected D1 tests green.
5. **CI/integration:** branch protection, no-secret PR previews, per-module interface version and parity fixtures, no failing builds and no destructive staging writes.

**Then** begin multiple independent module branches with the following dependency order: M05 inventory/purchases → M06 POS/sales → M07 returns; M08 finance follows M06 and may overlap M07 only after the posting interfaces are frozen. M09 reporting/UI may prepare separate read-only design/QA earlier but cannot claim data parity until M05/M07/M08 exist.

## Coordination policy

- One integrator owns the shared D1 schema and transaction kernel. Never assign financial SQL writes to independent agents concurrently.
- Every issue/PR must record `workstream`, `depends-on`, `file owner`, `read/write scope`, `test gate` and `merge sequence`.
- A green CI build / preview is **not** proof of accounting correctness or a production-ready ERP.
- Turn the readiness flag on only after explicit checklist review, and send the owner a status change notification at that milestone. Until then, say **parallel preparation ready; module implementation blocked**.
