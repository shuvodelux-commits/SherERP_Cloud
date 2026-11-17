# M01–M11 Parallel Execution Rules — SherERP Cloud

**Owner-approved operating model, 17 November 2026.** All eleven ChatGPT/Codex conversations work on one repository, shuvodelux-commits/SherERP_Cloud, with GitHub main as the sole integration source of truth. Read AGENTS.md, docs/WORKSTREAMS.md, docs/M03_PARALLEL_READINESS.md and ADR-007 before changing code. The pinned Mohim_ERP source is read-only. Remote Desktop Commander is used only for genuinely local-machine work.

## Readiness decision — two different permissions

**PARALLEL-PREPARATION = READY.** Each M01–M11 lane may independently plan, audit frozen source, add module-owned isolated tests/fixtures, write nondeployable internal proofs, and prepare reviewed designs or read-only adapters. Independent PRs and 42+ GitHub CI workflows may run concurrently.

**PARALLEL-SHARED-TRANSACTION-WRITES = BLOCKED.** Do not assume internal synthetic D1 proofs are deployable purchases, sales, returns, cash, auth or stock writers. No public RPC exposure, unapproved financial SQL/posting, production/staging D1 import, or live migration. The unlock checklist is docs/M03_PARALLEL_READINESS.md: complete M02/Party source identity and account reconciliation, M03 awaited repository and shared atomicity contracts, M04 real D1 authenticated authority, a single approved posting/reversal kernel owner, and safe CI/integration evidence. A green test suite alone is not the unlock.

## Each chat's exclusive lane (file ownership is a coordination convention, not automatic GitHub enforcement)

| Chat | Scope it may advance independently now | Primary paths (examples, not unrestricted grants) | Dependent/blocked changes |
| --- | --- | --- | --- |
| M01 | Original UI/mobile/printing/Playwright regression QA; no redesign | qa/m01*, M01-only fixtures and plans | Production frontend/raw or global RPC change requires M03/M01 integration review |
| M02 | Source group mappings, offline import/dry-run, reviewed Party identity evidence, local D1-only tests | scripts/dry-run-*, M02-only fixtures/tests/docs | Actual shared D1 migrations and money-account DDL go through the shared schema integrator |
| M03 | **SINGLE OWNER/INTEGRATOR** of shared D1 repository, numbered migrations, transaction kernel, and async/RPC contracts | src/db, migrations, shared posting files, relevant M03 source tests | No public RPC writer before M04 authority and signed integration gate |
| M04 | Auth/RBAC/session contracts, isolated login and unauthorized-access D1 tests | src/auth, M04-only tests/fixtures/docs | Shared src/rpc and production login activation require M03-controlled integration and verified sessions |
| M05 | Products/lots, multi-unit and Tiles Box/Pcs/Sqft contracts; isolated purchase/FIFO D1 proofs | M05-specific src/modules files, tests/fixtures, plans | Real purchase stock/supplier ledger posting waits on M03/M04 shared kernel |
| M06 | POS V2, sales, split tender and cash-session source parity; isolated atomic proofs | M06-specific modules, tests and docs | Real sale posting requires approved M05 stock interfaces, auth and shared kernel |
| M07 | Original-lot returns/edit/delete and exactly-once reversal proofs | M07-specific modules, tests and docs | Real returns require approved M06/M05 posting interfaces; do not create second correction engine |
| M08 | Cash/Bank/Party independent account contracts, opening historical balances, read-only reconciliation and isolated local-D1 proofs | M08-specific modules, tests and docs | Cash Session/Party/ledger production writers require M03 integrator, M04 auth and source reconciliations |
| M09 | Reports, settings, Day Book, display-only eligibility and original UI/print QA | M09-specific internal modules, tests and docs | Do not enable public financial reports without reviewed M05–M08 data parity |
| M10 | Migration rehearsal design, discrepancy templates, integrity and recovery checks against synthetic or sanctioned staging evidence | docs/runbooks, M10-only scripts/tests and plans | No private export, destructive migration or remote database write without explicit owner cutover approval |
| M11 | Launch/ops checklists, safe CI/previews, rollback/monitoring specifications | M11-only runbooks, docs and CI proposals | No actual production D1 binding, payment activation or traffic cutover until M10 approval |

Existing issue references for coordination: M01 #25; M02 #24; M03 #22; M04 #23 and #252; M05/M06/M07 #314; M08 #66/#452; M09 #431; M10 #312; M11 #306. Use existing issues rather than duplicating them. If scope changes, open a new scoped issue and record its dependencies.

## Shared-file ownership and change reservation

The M03 integration owner exclusively coordinates edits affecting src/db/**, migrations/**, shared SQL posting/receipt kernel, shared invoice/stock IDs, src/rpc/**, src/index.js, wrangler*.jsonc, source-to-D1 transaction interfaces, and the Cash Session authorization boundary. Other lanes must request a small contract/patch proposal in a GitHub issue, state affected files and account invariants, and wait for the integrator to schedule **one** integration PR. M02 owns source semantic proposals; the integrator owns the actual common migration commit. Any agent may add isolated test-only D1 fixtures in its named lane but must not silently promote them to migrations. M01 controls preserved UI QA; M11 coordinates shared CI/workflows, with all modules reviewing changes to gates. AGENTS.md and docs/WORKSTREAMS.md are integration-only coordination files.

For paths shared by two features, **one branch owns the edit at a time**. Record in the PR or issue: Workstream, issue number, exact path list, whether read-only/test-only/writer, base main SHA, blocking dependency PRs, integration owner and proposed merge order. If two branches claim the same path, stop the later write and use a small contract PR; do not race or force-push over the first branch. Do not share local working trees or environments among chats.

## Standard chat startup and branch protocol

1. At the start of **every new task**, fetch fresh origin/main, open PRs, AGENTS.md, this file, dependencies and the module's active issue; a previous chat's merged badge is not proof code exists on main.
2. Give a 10–15-sentence implementation overview before beginning new module functionality; respect the owner's module approval workflow. Documentation-only coordination is not a feature build.
3. Pick one small issue/objective. Use an independent branch named m01/<scope>, m02/<scope> … m11/<scope> (or integration/<scope> for the shared integrator). Start from fresh main, never from another chat's unmerged feature branch unless the dependency is explicitly stacked and described.
4. Work GitHub-first with Superpowers RED failing acceptance test → smallest GREEN implementation → refactor if useful → full affected real Workerd/D1/browser CI. Follow KISS; do not redesign the source UI or bypass source/ledger parity.
5. Open exactly one scoped PR per independently reviewable objective, targeting main whenever prerequisites are merged. Fill the PR template: issue, workstream, file ownership, affected endpoints/tables, dependency heads, source SHA, test evidence, risk/rollback and merge order.
6. Merge gate: exact current PR head checks must pass (fast feedback is informational, **not** a substitute for full checks), GitHub required reviews/protections satisfied, no merge conflicts, owner-approved protected data paths, and no missing parent integration. Never force green, waive a failing M03 test or reuse stale status.
7. On merge, verify target branch is **main** and exact changed files are present on main; merged child PRs targeting feature branches do **not** count as main integration. If stacked, explicitly open/merge the parent PR to main. Update the issue with SHA and test evidence.
8. After another module merges into main, recheck your dependencies, refresh only when necessary, avoid needless CI-invalidating rebases, and document the final interface version. The existing hourly CI monitor is a helper, not an instant lock manager; GitHub is authoritative.

## Shared interface handshake (before dependent feature integration)

M03 + M04 publish: tenant/session/actor authority proof (including disabled/revoked users and source IDs); repository methods with explicit await behavior; versioned stable IDs; SQL-enforced idempotent atomic stock+ledger+Cash/Bank posting; exact-once reversal and Cash Session semantics; and immutable Party role-separated accounts without automatic netting. M05 then freezes stock/purchase contracts; M06 can integrate real POS once M05 passes; M07 and M08 may integrate after M06 and their corresponding approved contracts. M09 real reports require M05/M07/M08 parity. M10 validates integrated source/historical data, and only M11 owner-controlled cutover activates production.

**Safe parallel preparation does not change the readiness flag in docs/M03_PARALLEL_READINESS.md.** Do not mark PARALLEL-MODULE-READY until the full checklist is verified and documented by a dedicated reviewed PR.

## Conflict, security and release escalation

- Conflict on common file: mark affected PR blocked, leave both module-owned branches intact, request M03 integrator decision and write the chosen merge sequence in the issue. Never overwrite another chat's branch.
- D1 migration, public auth or posting defect: stop the impacted lane's integration; preserve tests, legacy data, balances, source IDs, role direction, FIFO, returns and Cash Session behavior.
- Remote D1 import or customer data: separately owner-approved backup/cutover, no credentials in GitHub, no original Sheets mutation.
- Empty RPC registry or database:not-connected is intentionally fail-closed; do not represent it as full ERP functionality.
- CI optimization may cache npm downloads and cancel superseded PR runs but must not skip mandatory real-D1, accounting, auth, security or browser checks.

**This document enables 11 coordinated preparation/proof lanes NOW, not 11 simultaneous production transaction writers.**
