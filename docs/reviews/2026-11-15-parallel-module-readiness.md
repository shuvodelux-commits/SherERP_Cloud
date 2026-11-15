# SherERP Cloud — Parallel Transaction Module Readiness Review (2026-11-15)

**Decision: NOT PARALLEL-MODULE-READY.** Independent module planning, read-only proofs and UI QA can continue on isolated branches. Multiple writers of shared D1 schema, Party/stock/invoice posting, cash-session and ledgers remain blocked.

**Authority:** AGENTS.md, docs/M03_PARALLEL_READINESS.md, docs/WORKSTREAMS.md, ADR-007 Unified Party, frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, and live GitHub evidence as of this review. CI success on synthetic D1 proof is not production acceptance.

| Required gate | Evidence present | Blocking missing evidence | Decision |
| --- | --- | --- | --- |
| M02/M02-P identity + source reconciliation | Reviewed Unified Party architecture, local D1 Party IDs/review tools and source-shaped catalog migrations 0001/0002 | Full source 49-group import with strict original IDs/role account signs; human-reviewed ambiguous links; repeatable total reconciliation and high-water counter cutover | BLOCKED |
| M03 awaited D1 CRUD and posting | Source catalog reads/guards, M03 async graph audit, synthetic atomic receipt/posting; PR #248 isolated PCAT/PUNT creation proof, no production DDL | Complete 394 impacted-function async closure, deployed-compatible catalog transaction schema, all live source RPCs, source FIFO/ledger invoice corrections and atomic shared posting | BLOCKED |
| M04 current session + RBAC | Internal local-only auth_sessions/users/roles schema proposal and Workerd tests, Settings and Reports authorized internal readers/writes | Production-compatible reviewed D1 auth migrations/cutover, real source staff provisioning, products.add authorization **inside** the master create SQL, authorized public RPC handlers | BLOCKED |
| Shared financial SQL kernel | Isolated synthetic Workerd D1 idempotency, revocation, stock and journal proofs; explicit owner required for src/db | Single approved posting/reversal kernel with shared source IDs, Cash Session policy, Party debit/credit signs and exactly-once failure tests against real integrated schema | BLOCKED |
| CI and rollout | GitHub PR checks, M01 Chromium preservation, source SHA verification, secret-free Cloudflare preview checks | Authenticated end-to-end source workflow parity, protective merge gating and reviewed production/staging D1 backup/migration/cutover path; /api/rpc remains disabled | BLOCKED |

## Recent verified PR evidence

- PR #215 Product master bootstrap reference fields: merged, exact-head GitHub tests green.
- PR #226 Product Category/Unit status workflow: merged at 6c7cbe1f, 10/10 checks green; strictly internal.
- PR #230 source-shaped creation preflight: merged at 22fcc89f, 10/10 checks green; read-only.
- PR #248 atomic master create local proof: draft at this review. Exact-head Foundation 1,508/1,508 passing, 84 frozen source files and 36 HTML includes verified. Real Workerd/D1 check and full exact-head CI must be verified separately before any merge claim. The schema is in tests/fixtures, NOT a deployable migration.
- Frozen async closure: 614 named GAS functions, 394 read/write affected, 47 GAS source files. See docs/reviews/2026-11-15-m03-async-gap-review.md.

## Execution order / ownership

1. M03 schema owner: review and finish PR #248 local D1 proof, resolve real Workerd CI and merge only after owner approval. Do not promote its synthetic DDL automatically.
2. Joint M03+M04: build separate test-first and schema-reviewed **products.add/products.edit** authority against real proposed M04 session epoch, inside the same D1 mutation. Privileged current master writes are not currently callable publicly.
3. M03 async audit owner: source function → awaited repo method → permission → exact SQL atomicity test; track all 394 impacted functions, give every unresolved dynamic path a named owner and test.
4. M02-P/shared kernel owner: complete original data import, Party account direction reconciliation, source ID sequence floors, stock/invoice/cash-session posting boundary and reversal proof.
5. Integrator: rerun full GitHub checks, verify PR heads, compare current main and review scope; update readiness flag to PARALLEL-MODULE-READY **only after every row above becomes verified**. Production D1 deployment/cutover is a separate explicit owner approval.

## Release boundary

Keep Cloudflare Workers Builds as the only preview owner; previews bind no source/customer/staging/production D1 data. Public /api/rpc must continue fail-closed (501); no new public product write endpoints. No remote D1 writes, no original frontend rewrite. No direct merges into main.

**Bottom line:** Preparation is progressing, but readiness is NOT achieved and this review is not authorization to enable the ERP.