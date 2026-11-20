# SherERP Cloud — Project Status, Handoff & Task Board

> **Single operational entry point for the active project.** This is a dated status snapshot and handoff, not permission to deploy or change data. For the latest truth, re-check GitHub main, open PRs, issues, checks and the authoritative architecture/release documents linked below.
>
> **Snapshot:** 2026-11-20 (Asia/Dhaka) · GitHub main `e23c80a17d34bd9d1633ee28ba019ae0819f0911` · **MVP: IN PROGRESS** · **Production: NO-GO**.
>
> **Original source of business truth:** [Mohim_ERP](https://github.com/shuvodelux-commits/Mohim_ERP) at pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Do not modify legacy GAS or its source data without a separate approved migration/cutover.

## 1. Mission and MVP decision

Deliver the **existing** original HTML/CSS/JS SherERP interface on Cloudflare Workers + Hono (where useful) + D1, preserving source behavior and transaction semantics. **Do not rebuild the UI or add unnecessary architecture.** Optimize for a solo operator and a small first launch.

Three coordinated objectives:

1. **Finish a correct, authenticated ERP:** product → purchase → FIFO stock → POS/payment → return/reversal → gross Party/cash/bank/ledger reporting and printing. Existing functionality must not be silently removed.
2. **Minimal tenant Control Center:** secure sole Super Admin, business list/search/create/status, Owner Gmail onboarding, simple diagnostics, and later an **Open ERP** support action using a separately authorized tenant-scoped session. No Owner password reuse or cross-tenant bypass.
3. **Portable Cloudflare installation:** same code, new Cloudflare account through configuration/scripts and a simple guide, without editing application source. Newly created tenant databases require approved provisioning/binding/migration logic.

**Absolute quality gate:** zero **known** critical money, stock, posting, idempotency or reconciliation defects. Monetary precision, FIFO/multi-unit/Tiles, historical identity, atomic writes, authenticated actor, gross Party roles, failure rollback, and data recoverability are not post-MVP extras. Tests provide evidence—not a promise that all bugs are impossible.

## 2. What is verified now — do not infer more

| Area | Evidence at snapshot | Operational meaning |
| --- | --- | --- |
| M00/M01 baseline and original UI | Frontend build/QA and original POS V2 regressions, including merged [#749](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/749) and [#755](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/755) | Original UI preserved and tested; NOT complete live business API |
| M02 source/schema/Party | 14 numbered base migrations; Tiles [#438](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/438)/[#439](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/439); local Supplier/Party tests | Not all original 49 data groups reconciled in approved private staging |
| M03 shared Worker/D1 kernel | Local two-shop Owner→Product [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742), Cash Session local proof [#752](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/752), first new-shop purchase atomic proof [#758](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/758) | Components are locally proved; shared integrated business writer/public activation still **BLOCKED** |
| M04 auth/authorization | Local D1 Google/Owner session, POS permission and SQL-time authority tests | Staging/production end-to-end authenticated transaction gate remains to be signed off |
| M05/M06/M07 inventory/POS/returns | Source-parity and isolated D1 FIFO/sale/return/reversal proofs; mixed-unit/Tiles coordination in [#314](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/314) | Complete real Shop D1 purchase→sale→return integration remains to be accepted |
| M08 finance/accounts | Golden cases, exact money and lossy Number round-trip guard [#741](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/741) | Gross ledger and exact conservation signoff **not complete** |
| M09 reports/settings | Internal read contracts/projections and browser QA | Full authenticated, source-faithful production report values not accepted |
| M10 migration/recovery | Synthetic/local SQLite/Workerd checks; issue [#312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) **0/9 signed acceptance items** | Real private staging import/reconciliation/restore still **NOT VERIFIED** |
| M11 production | Runbooks and preflight/preview safeguards; issue [#306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) **0/10 release items** | **NO-GO**, no production D1 cutover authorization |
| PORT-00 / tenants | Portable P1 drafts, P2 read-only preflight [#757](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/757), local Create/Resume/roster [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722)/[#735](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/735) | Hosted automatic provisioner, second-account installation and delegated ERP Support Access **not ready** |

The **public** `src/index.js` still declares `database: 'not-connected'`; `src/rpc/registry.js` is intentionally empty. Public PR previews are D1-free. Do **not** mistake preview/health/green isolated tests for a live ERP.

**GitHub governance note:** main had an active protection ruleset when inspected on 2026-11-20; the older M11 release issue contains an earlier branch-protection finding. Independently recheck **enforced required checks/reviews and environments** before any GO; do not silently update release checkboxes based only on a ruleset name.

## 3. Live coordination and next safe work

**At this snapshot, open PRs (statuses can change):** [#759](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/759) M03 tenant directory/search, [#761](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/761) M01 POS price QA, [#762](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/762) M02 Supplier gross ledger, [#763](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/763) M03 Cash Session races, [#764](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/764) M10 Party/opening reconciliation. **Check their current merge state, reservations and exact-head CI before touching shared files.**

| Priority | Task / owner lane | Blockers and completion evidence |
| --- | --- | --- |
| **P0** | **M02 + M03 + M04: one real authenticated Shop D1 transaction boundary** | Approved Party/source IDs; current server-side session/role/tenant/Cash Session; SQL-atomic idempotent single-writer kernel and negative/replay/concurrency/rollback tests. M03 owns shared schema, migrations, RPC and posting. |
| **P0** | **M05/M06/M07/M08: first clean-shop financial loop** | Real Product → Purchase → FIFO → POS split tender → Return/reversal → Cash/Bank/Party/stock reconciliation against exact golden amounts. Block activation on differences. |
| **P0** | **M01/M09: original ERP UI ↔ authenticated API parity** | Browser desktop/mobile/POS/invoice/print flows on approved real endpoints; no silent dummy data/saves. |
| **P1** | **M03 + M04: minimal tenant directory and Owner onboarding** | Complete/merge approved #759 only after review; verify hosted Control D1/resource binding; two separate Shop D1s and correct Owner access. See [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690). |
| **P1** | **M03 + M04: delegated tenant ERP support** | Only after trusted ERP routing/session boundary. Add Open ERP → tenant-scoped, revocable, read-only by default; show Support Mode, attribute authorized edits to Super Admin; cross-tenant denial and audit tests. No Owner impersonation. |
| **P1** | **PORT-00: install on new Cloudflare account without source edits** | Config validator/generator, account preflight, secure Admin bootstrap, D1/binding provisioning, no-secrets setup, second-account evidence. See [#699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699). |
| **P0 release** | **M10 + M11: recovery and GO/no-GO** | Approved real private import of all 49 groups, source-ID/stock/FIFO/gross-ledger precision reconciliation, backup/restore and acknowledged-write replay, security/performance, owner-approved single-writer cutover. |

**Current critical path:** finish shared M02/M03/M04 writer/auth boundary → one fully reconciled M05–M08 real workflow → original UI integration → real M10 restore/reconciliation → M11 production signoff. Tenant directory/portable config may progress in independent scoped PRs without competing for shared files.

## 4. Accounting and data non-negotiables

- Use exact money units/decimal conversion; define rounding stage explicitly (line vs invoice vs helper), protect all payload boundaries.
- No double posting: operation IDs, source IDs and replay intent checked inside D1 posting; concurrent last-item sales cannot oversell contrary to approved policy.
- Keep Customer/Supplier/Vendor/Owner/Lender/Borrower/Payee **separate gross accounts** on one Party identity; no automatic role netting, Owner equity ≠ loan, no inferred identity merges.
- Preserve purchase FIFO by source purchase-date then lot-ID ordering; immutable historical unit/tiles/price factors and original-lot return allocations.
- Apply Cash Session policy to actual cash posting when enabled, not historical opening positions.
- Failure-inject purchase/sale/return/settlement and verify no partial cash/ledger/stock changes; test duplicate request, stale role/session and tenant-binding swaps.
- Never replace private migration readbacks with mock counts; zero unexplained critical variance is mandatory.
- Backup alone is insufficient; verify real restore and treatment of post-cutover acknowledged writes.

**Release decision remains NO-GO** until independent evidence has been accepted under [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) and [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306).

## 5. Solo-admin KISS scope

**Ship before MVP:** small Control Center with login, business search/list, Add Business, Owner Gmail, setup/status/retry, basic diagnostics, secure Open ERP support **once its authorization is actually implemented**. Plain deployment scripts + six or fewer core setup instructions are enough; no graphical installation wizard.

**Defer:** enterprise billing, multi-admin departments, complex ticketing, dashboards, broad analytics, new framework, microservices and optional cross-role manual settlement (separate approval gate).

**Support rule:** the platform admin is not the tenant Owner. Do not share Owner cookies/passwords; audit real support actor; default to read-only, authorize edits through original validated ERP operations, never raw D1 edits.

## 6. Handoff protocol — start the next chat or implementation run here

1. Read this **PROJECT.md**, mandatory **AGENTS.md**, **docs/PARALLEL_EXECUTION.md** and module-specific contracts. If Party/finance is touched, read **ADR-007**.
2. Fetch latest GitHub main SHA, open PRs, CI checks, issues #456, #22/#23 and the exact module issue. **This snapshot is not live state.**
3. Reserve a single owner and file scope in [parallel board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), especially for M03-controlled `src/db`, migrations, `src/rpc`, Worker entry and posting.
4. Give the user a 10–15 sentence implementation overview before beginning a new module; follow the owner's approval protocol.
5. Create a fresh branch from latest main; run **/super build → /super qa → /super review**, including **RED → minimal GREEN → refactor → retest** for executable code.
6. Run focused local Workerd/D1 tests, source-parity and Playwright where affected, full required GitHub CI and independent review. A cancelled or pending run is not PASS.
7. Open one appropriately scoped PR, list exact source/base SHAs, changed paths, tests, limitations, dependencies and rollback. **Do not merge without owner approval**.
8. On reviewed merge, update the **relevant issue** and this single project snapshot: status, evidence, next task and dependency changes. Do not create a new throwaway handoff .md per chat.
9. Never run remote D1 writes, real customer/staff imports, public financial RPC activation, production bindings or legacy GAS freeze without explicit separate authorization.

**Suggested one-line next task:** “Refresh main/issues/PRs, then complete the smallest M03/M04-approved authenticated Shop D1 business posting integration while preserving exact accounting and the public fail-closed boundary.”

## 7. Authoritative references (retain; do not duplicate)

- **Agent rules:** [AGENTS.md](AGENTS.md) — mandatory safety, Superpowers TDD, source fidelity.
- **Architecture and original migration scope:** [docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md), [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md), [ADR-007](docs/architecture/ADR-007-unified-party-relationships.md).
- **Ownership and integration gates:** [docs/PARALLEL_EXECUTION.md](docs/PARALLEL_EXECUTION.md), [docs/M03_PARALLEL_READINESS.md](docs/M03_PARALLEL_READINESS.md), [docs/M03_G1_INTEGRATION_HANDOFF.md](docs/M03_G1_INTEGRATION_HANDOFF.md), [board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
- **Tenant provisioning:** [clean-shop issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [docs/CLEAN_SHOP_HANDOFF.md](docs/CLEAN_SHOP_HANDOFF.md) (historical detail), [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699).
- **Portable installation:** [docs/installation/START_HERE.md](docs/installation/START_HERE.md) (**planned; not yet fully executable**), [docs/installation/PORTABILITY_ROADMAP.md](docs/installation/PORTABILITY_ROADMAP.md).
- **Release:** [docs/runbooks/M11_RELEASE_READINESS_MATRIX.md](docs/runbooks/M11_RELEASE_READINESS_MATRIX.md), [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312), [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306).

## 8. Markdown cleanup policy and historical evidence

Repository inventory at the snapshot: **961 tracked .md files** — **562** under docs/superpowers/plans and **259** under docs/superpowers/specs; no empty or byte-identical .md files were found. Many old plans/specs contain unique TDD decisions cited by PRs or mandatory architecture documents. **Do not bulk delete those based only on filenames.** Git history alone is not a substitute for deliberately preserving linked reviewer evidence while workstreams are active.

This documentation cleanup retires just two clearly superseded one-off notes:
- **docs/continuation/M02_CONTINUE.md** — a paused 17 November #438/#439 checkpoint; [#438](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/438) and [#439](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/439) subsequently merged.
- **docs/CLOUDFLARE_PREVIEW_SMOKE_TEST.md** — instructions solely for already-merged one-time [PR #14](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/14); the maintained [Cloudflare GitHub setup](docs/CLOUDFLARE_GITHUB_SETUP.md) remains.

Future cleanup may retire more generated documents only after scanning incoming file links, CI/script references, active issue/PR citations, and verifying preservation of audit-relevant evidence. Keep this file as the **one** current progress/handoff/task board; keep detailed specialist contracts and runbooks only as reference documents.

## 9. Update template for future merges

Replace snapshot SHA/date and edit the affected row/task in this file. Include:
- **Merged PR / exact main SHA:**
- **Module and completed, test-verified behavior:**
- **Real Workerd/D1/browser/CI evidence and limitations:**
- **Still missing or blocked (never erase an unresolved gate):**
- **Current next task / file owner / issue:**
- **Any changed release/financial decision backed by independent reviewer signoff:**

**Do not mark production-ready simply because PRs merged or Cloudflare produced a successful Worker build.**
