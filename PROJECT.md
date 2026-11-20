# SherERP Cloud — Project Status, Handoff & Task Board

> **Single operational entry point for the active project.** This is a dated status snapshot and handoff, not permission to deploy or change data. For the latest truth, re-check GitHub main, open PRs, issues, checks and the authoritative architecture/release documents linked below.
>
> **Snapshot:** 2026-11-20 (Asia/Dhaka) · GitHub main `0024b79e2f4959dd7d3dae8dd19213012da0c01e` · **MVP: IN PROGRESS** · **Production: NO-GO**.
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
| M03 shared Worker/D1 kernel | Two-shop Owner→Product [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742), local Cash Session proof [#752](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/752), local first purchase proof [#758](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/758), and private clean-shop Supplier Quick Add [#791](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/791) merged; operational credit Purchase is [open #795](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/795) | Selective private Owner features exist; full authenticated financial loop and approved shared writer/public activation are **BLOCKED** |
| M04 auth/authorization | Local D1 Google/Owner session, POS permission and SQL-time authority tests | Staging/production end-to-end authenticated transaction gate remains to be signed off |
| M05/M06/M07 inventory/POS/returns | Source-parity, isolated Workerd/D1 FIFO, sales and reversals; [#792](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/792) merged a **nonposting** original POS V2 one-SKU intent contract; [open #797](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/797) tests original cart price/stock compatibility | Original POS V2 → real authenticated Shop D1 posting, full split tender/multi-unit/Tiles and native purchase→sale→return remain to be accepted |
| M08 finance/accounts | Golden cases, exact money and lossy Number round-trip guard [#741](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/741) | Gross ledger and exact conservation signoff **not complete** |
| M09 reports/settings | Internal read contracts/projections and browser QA | Full authenticated, source-faithful production report values not accepted |
| M10 migration/recovery | Synthetic/local SQLite/Workerd checks; issue [#312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) **0/9 signed acceptance items** | Real private staging import/reconciliation/restore still **NOT VERIFIED** |
| M11 production | Runbooks and preflight/preview safeguards; issue [#306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) **0/10 release items** | **NO-GO**, no production D1 cutover authorization |
| PORT-00 / tenants | Portable P1 drafts, P2 hosted read-only preflight [#757](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/757), local Create/Resume/roster [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722)/[#735](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/735), minimal tenant directory UI/search [#759](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/759) merged | Hosted automatic provisioner, second-account installation and delegated ERP Support Access **not ready** |

The **public** `src/index.js` still declares `database: 'not-connected'`; `src/rpc/registry.js` is intentionally empty. Public PR previews are D1-free. Do **not** mistake preview/health/green isolated tests for a live ERP.

**GitHub governance note:** main had an active protection ruleset when inspected on 2026-11-20; the older M11 release issue contains an earlier branch-protection finding. Independently recheck **enforced required checks/reviews and environments** before any GO; do not silently update release checkboxes based only on a ruleset name.

## 3. Live coordination and next safe work

**Open PRs are live, not stored here:** use the [GitHub open PR queue](https://github.com/shuvodelux-commits/SherERP_Cloud/pulls?q=is%3Apr+is%3Aopen), [parallel ownership board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456) and the specific module issues. Do not reuse an older open-PR list without refreshing exact-head CI, merge state and file reservations.

**Recent milestones verified merged by this checkpoint:** [#759](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/759) minimal tenant directory UI/search; [#761](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/761) POS price browser QA; [#762](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/762) Supplier gross-ledger proof; [#763](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/763) Cash Session race proof; [#764](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/764) Party/opening reconciliation proof; [#766](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/766) initial project documentation cleanup. None of these individually authorizes production financial posting.

| Priority | Task / owner lane | Blockers and completion evidence |
| --- | --- | --- |
| **P0** | **M02 + M03 + M04: one real authenticated Shop D1 transaction boundary** | Approved Party/source IDs; current server-side session/role/tenant/Cash Session; SQL-atomic idempotent single-writer kernel and negative/replay/concurrency/rollback tests. M03 owns shared schema, migrations, RPC and posting. |
| **P0** | **M05/M06/M07/M08: first clean-shop financial loop** | Real Product → Purchase → FIFO → POS split tender → Return/reversal → Cash/Bank/Party/stock reconciliation against exact golden amounts. Block activation on differences. |
| **P0** | **M01/M09: original ERP UI ↔ authenticated API parity** | Browser desktop/mobile/POS/invoice/print flows on approved real endpoints; no silent dummy data/saves. |
| **P1** | **M03 + M04: minimal tenant directory and Owner onboarding** | #759 is merged; now verify the actual hosted Control D1/resource binding, two distinct Shop D1s and current Owner access. Do not claim a local directory test is a hosted tenant management system. See [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690). |
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

**Suggested one-line next task:** “Refresh GitHub main, open PRs #795/#797/#798 and coordination #456 first. Review/finish the reserved M03 credit-Purchase vertical slice and M06 source-cart gate on their existing branches; do not create a duplicate writer. Then advance the next approved authenticated clean-shop POS/return slice with exact accounting, local Workerd/D1 tests and public fail-closed isolation.”

## 7. Authoritative references (retain; do not duplicate)

- **Agent rules:** [AGENTS.md](AGENTS.md) — mandatory safety, Superpowers TDD, source fidelity.
- **Architecture and original migration scope:** [docs/MIGRATION_PLAN.md](docs/MIGRATION_PLAN.md), [docs/WORKSTREAMS.md](docs/WORKSTREAMS.md), [ADR-007](docs/architecture/ADR-007-unified-party-relationships.md).
- **Ownership and integration gates:** [docs/PARALLEL_EXECUTION.md](docs/PARALLEL_EXECUTION.md), [docs/M03_PARALLEL_READINESS.md](docs/M03_PARALLEL_READINESS.md), [docs/M03_G1_INTEGRATION_HANDOFF.md](docs/M03_G1_INTEGRATION_HANDOFF.md), [board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
- **Tenant provisioning:** [clean-shop issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), historical provisioning evidence in [#720](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/720), [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722), [#735](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/735) and [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742), [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699).
- **Portable installation:** [docs/installation/START_HERE.md](docs/installation/START_HERE.md) (**planned; not yet fully executable**), [docs/installation/PORTABILITY_ROADMAP.md](docs/installation/PORTABILITY_ROADMAP.md).
- **Release:** [docs/runbooks/M11_RELEASE_READINESS_MATRIX.md](docs/runbooks/M11_RELEASE_READINESS_MATRIX.md), [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312), [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306).

## 8. Markdown cleanup policy and historical evidence

Before this continuation, **965 tracked .md files** remained — **567** Superpowers plans and **259** specs. This PR retires one further historical handoff, leaving **964 Markdown files** on its branch; concurrent merges may change the count. The earlier inspection of 961 files found no empty or byte-identical duplicates; a full reference audit is still required before large-scale pruning. Many old plans/specs contain unique TDD decisions cited by PRs or mandatory architecture documents. **Do not bulk delete those based only on filenames.** Git history alone is not a substitute for deliberately preserving linked reviewer evidence while workstreams are active.

The first cleanup (#766) retired two superseded one-off notes; this continuation also retires the dated clean-shop handoff in favor of this central file and the source PRs:
- **docs/continuation/M02_CONTINUE.md** — a paused 17 November #438/#439 checkpoint; [#438](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/438) and [#439](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/439) subsequently merged.
- **docs/CLOUDFLARE_PREVIEW_SMOKE_TEST.md** — instructions solely for already-merged one-time [PR #14](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/14); the maintained [Cloudflare GitHub setup](docs/CLOUDFLARE_GITHUB_SETUP.md) remains.
- **docs/CLEAN_SHOP_HANDOFF.md** — dated checkpoints superseded by this current task board and [clean-shop issue #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690). Provenance remains in merged [#720](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/720), [#722](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/722), [#735](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/735), and [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742).

Future cleanup may retire more generated documents only after scanning incoming file links, CI/script references, active issue/PR citations, and verifying preservation of audit-relevant evidence. Keep this file as the **one** current progress/handoff/task board; keep detailed specialist contracts and runbooks only as reference documents. Run `node scripts/check-project-docs.mjs` (also included in Node test discovery) before PR review: it checks local Markdown links in PROJECT, README and AGENTS against tracked files without network access.

## 9. Update template for future merges

Replace snapshot SHA/date and edit the affected row/task in this file. Include:
- **Merged PR / exact main SHA:**
- **Module and completed, test-verified behavior:**
- **Real Workerd/D1/browser/CI evidence and limitations:**
- **Still missing or blocked (never erase an unresolved gate):**
- **Current next task / file owner / issue:**
- **Any changed release/financial decision backed by independent reviewer signoff:**

**Do not mark production-ready simply because PRs merged or Cloudflare produced a successful Worker build.**


## 10. Codebase-wide audit and immediately executable AI-agent handoff — 20 November 2026

### Audit basis and confidence

- **Immutable inspected tree:** GitHub main **0024b79e2f4959dd7d3dae8dd19213012da0c01e** (20 November 2026, Asia/Dhaka). The recursive Git tree was enumerated in full (reported *truncated=false*): **2,531 tracked files**, including **330 src/**, **771 tests/**, **28 qa/**, **79 scripts/**, **84 legacy/**, **68 .github/workflows/**, **40 SQL files**, and **987 Markdown files**. Many Markdown files are historical tests/plans; their quantity does not measure implementation completion.
- **Source-focused inspection:** Public Hono entry/HTTP/RPC registry and transport; private platform/Owner Worker entrypoints; Owner frontend adapter/build; selected D1 schema/product/Supplier/session/atomic-sale proof modules; portable provisioning; POS intent; unit/Tiles/return/finance/report module inventory; package scripts, main Wrangler, preview safety, GitHub workflows, existing independent accounting QA, and relevant release/issues/PRs. The complete tracked path list was inventoried; **not every one of the 2,531 files was reviewed line-by-line**.
- **Evidence type:** Read-only GitHub code and CI/configuration audit. **This handoff did not run npm tests, local Workerd/D1 tests, browser tests, remote database operations, or Cloudflare deployment.** Earlier test PASS counts in specialist review documents belong to those earlier runs, not to this audit. Recheck PR exact-head status before merge.
- **Public runtime proof from code:** [src/index.js](src/index.js) returns a foundation / database not-connected health descriptor; [src/rpc/registry.js](src/rpc/registry.js) is intentionally empty; [src/http/app.js](src/http/app.js) serves /api/health, /api/rpc and static assets. [wrangler.preview.jsonc](wrangler.preview.jsonc) binds assets and explicitly leaves previews empty; there is **no public financial D1 binding**.
- **Private scope:** [src/m03-private-platform-auth-worker.js](src/m03-private-platform-auth-worker.js) and [src/m03-owner-redemption-worker.js](src/m03-owner-redemption-worker.js) provide scoped private Admin/Owner routes. Their existence does not mean they are currently deployed, publicly routable, remotely bound, or integrated with all ERP source calls. [scripts/build-owner-frontend.mjs](scripts/build-owner-frontend.mjs) patches selected legacy calls and displays an unavailable-data notice where operations are unsupported. Never imply the source screens alone create real transactions.
- **Reference lineage:** legacy original [legacy/source](legacy/source) is a byte-pinned set of 47 .gs and 37 frontend source files from Mohim_ERP commit **29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2**. The 49 source data groups have inventory/mapping evidence, not an approved complete private historical import.

### Implementation status by operational boundary

| Boundary | Present in reviewed main | Still required for MVP |
| --- | --- | --- |
| M00/M01 source/UI | Source pin, original compiled HTML/CSS/JS, M01 browser/print checks, static deployment shell | Same original UI against approved **real authenticated** back-end data across POS, reports, invoicing and mobile |
| M02 schema/identity | Fourteen numbered base migrations, product/Party maps, offline source provenance, synthetic/real local tests | Independent 49-group source-ID, stock, supplier/customer and gross-account reconciliation with approved private evidence |
| M03 shared back end | Public HTTP fail-closed shell, local D1 adapters, private clean-shop Product/Supplier flows, local atomic-purchase and receipt proofs | **One reviewed SQL-atomic source-of-truth** purchase/sale/return/cash/ledger writer; complete async RPC closure and source identity contracts |
| M04 authentication | Google/Owner/Admin private modules, legacy staff tests, permission/session/SQL-current authority proofs | Hosted verified sign-in + MFA + revocation + Owner/staff/Shop scope on *every real financial mutation*; safe first-admin recovery |
| M05 inventory | FIFO, lots, standard units, mixed units, Tiles Box/Pcs/Sqft, oversold and virtual-bundle contracts and isolated proofs | Purchase → owned lot stock and exact inventory ledger integrated into canonical Shop D1, source-compatible corrections |
| M06 sales/POS | Original POS V2 screen and nonposting one-SKU checkout intent (#792), isolated Workerd sale cases | Real private Owner POS submission/receipt, immutable exact price/stock/discount, split tender, cash-session enforcement, retries/replays |
| M07 returns | Historical return and correction planners, isolated cash/store-credit reversal tests | Real approved original-lot sale/purchase return/edit/delete with **exactly-once** SQL reversal across stock, cash, bank and Party |
| M08 accounting | Separated gross role/finance read models, Cash/Bank/Day Book source parity and decimal-candidate evidence | Owner-approved numeric/rounding policy, real ledger posting/closing/reconciliation, gross debit-credit conservation for every operation |
| M09 reports/settings | Many source-shaped dashboard/daybook/report/settings readers and private tests | Original report values, saving, invoice/print, persistent settings verified from the **same committed** Shop D1 transactions |
| PORT-00 + tenants | P1 local instance configuration/preflight, limited private Admin/Owner flows, local Control/Shop provisioning/retry proofs | Real hosted Control D1, secure bootstrap/Access/Google, no-code Shop D1 provisioner and second-account install acceptance |
| M10/M11 release | Synthetic recovery, offline audit, deployment-safety runbooks and CI | **Signed private full-data migration/restore/performance/security proof and owner GO**; release remains **NO-GO** |

**Do not substitute one for another:** source or test-only module ≠ deployed Worker route ≠ connected D1 ≠ accepted transaction workflow ≠ production readiness. The independent [20 Nov financial QA](docs/reviews/2026-11-20-independent-accounting-qa.md) reported **49 proposed mappings with zero fully reconciled historical groups and 30 missing source-specific D1 DDL** at its then-reviewed commit; it also reported local synthetic Workerd suites, not a fully operational ERP. Independently remeasure those findings after later integration. [M08 monetary review](docs/reviews/2026-11-20-m08-run4-monetary-crossmodule-gaps.md) records a genuine **line-vs-invoice rounding divergence** (e.g., two unit-price 0.335 BDT lines: 68 vs 67 paisa); policy remains unapproved and MUST be resolved before new live money writes.

### Highest-priority current GitHub work — active PR reservation snapshot

The following were **OPEN** when this audit checked GitHub at main 0024b79e2f4959dd7d3dae8dd19213012da0c01e. Refresh their *actual* state, head SHA, checks, review and file ownership; this list is not a permanent queue:

| PR | Workstream | Current exclusive/changed files | Agent action |
| --- | --- | --- | --- |
| [#795](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/795) | **M03 P0** operational credit Purchase | Private Owner Worker, Owner frontend build, shared D1 owner-catalog/migration/additive purchase schema, browser + Workerd tests | **Do not duplicate or modify these shared paths from another lane.** Complete RED→GREEN and independent exact-head real Workerd, API, browser and financial review; if green and approved, merge before wiring dependent sale |
| [#797](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/797) | **M06 P0** POS default-cart source gate | M06-only POS intent module/test and plan | Resolve original auto price/negative shortage semantics only from trusted server price+stock inputs; remain nonposting until M03 accepts complete atomically checked sale |
| [#798](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/798) | M02 source data integrity | Offline purchase reference script and tests only | Finish stock-movement/Purchase Return exact lineage and quarantine tests; no source data alteration or D1 writer |

**Last confirmed main commits:** [#791 Supplier Quick Add](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/791), [#792 POS intent](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/792), [#793 purchase reference gate](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/793), [#794 return/stock-lot lineage](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/794). These merged contributions do **not** sign off the integrated MVP.

**File reservations:** [coordination #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456) remains authoritative. M03 is single integrator of shared src/db, migrations, src/rpc, Worker entrypoints and SQL posting kernel. M02 owns offline mapping, M04 auth-specific contracts, M05 inventory helpers, M06 POS helpers, M07 corrections, M08 money/ledger models, M09 UI/read models, M10 reconciliation/recovery, M11 cutover evidence. Check live PR changed filenames before choosing any file.

### Safest MVP completion sequence (do not expand scope)

1. **Refresh and close existing review gates:** pull latest main and all open PRs; review #795 first for real Owner → Supplier → credit Purchase → immutable lot and supplier payable; verify SQL-time actor/shop/session, source IDs, replay and rollback; do not merge a RED-only implementation or replace another branch's work.
2. **Prove a clean-Shop single-standard-SKU financial vertical slice** before generalized features: Owner login → Product/Supplier → Purchase → FIFO stock → POS V2 sale with current server price/stock authority → valid tender and Cash Session → native sale Return → correct receipt/ledger/stock/Party totals → reload and print. In Scope first: exactly one fresh Shop D1, owner-approved limited behavior, no fake successful saves. Fail closed on unsupported mixed-unit/Tiles/discount/credit combinations until corresponding contracts prove exact behavior.
3. **Unify exact monetary and identity policy** under M02/M03/M04/M05–M08. Fix source-vs-new-shop invoice/line rounding before activating live writes; ensure stock FIFO tie breaks, immutability, repeated requests, oversell/negative-stock policy, rejected replay with altered payload and reversal tests. Approved business-account model: **unified Party identity, seven independent gross role accounts, no auto-netting**.
4. **Connect the original UI end-to-end:** remove or replace unsupported adapter stubs only as real private endpoints are accepted. Real authenticated reads, writes, reload, saved invoice and reports must survive a fresh session. M01 QA owns browser, keyboard, touchscreen, mobile, print regression.
5. **Finish simple tenant onboarding:** after shared financial/Owner routing is safe, Admin creates **two distinct** Shop D1s with resumable state, Owner invitation and hard cross-shop denial; verify actual Cloudflare account resource IDs/bindings separately. Keep support access default-off, scoped, consented, audited; no Owner impersonation.
6. **M10 → M11 release:** privately authorized all-49-group import and independent reconciliation, restore + replay of acknowledged writes, performance/plan quota check, security, verified protected-main/reviewer controls, private rehearsal and owner-signed GO. Do not promote public shell or financial RPC as a shortcut.

**MVP scope discipline:** current priorities are functional purchase, POS, return, cash/bank/Party ledger, stock reports, invoices, secure Owner/Admin + simple tenant setup. Defer billing, full optional cross-role settlement, advanced SaaS analytics, React rebuild, speculative refactors and UI redesign.

### Agent start checklist and safe commands

1. Read **this PROJECT.md**, mandatory [AGENTS.md](AGENTS.md), [parallel rules](docs/PARALLEL_EXECUTION.md), [workstreams](docs/WORKSTREAMS.md), [ADR-007](docs/architecture/ADR-007-unified-party-relationships.md), selected issue and current PR discussion. Never trust an old handoff ahead of current main.
2. Record current **main SHA**, the frozen Mohim_ERP pin, and exact ownership reservation in #456. If a matching PR already exists, **continue/review that PR**, do not create a duplicate. For a new module give owner the mandated 10–15-sentence overview and obtain approval before implementation.
3. Use GitHub-first branch + small PR; Superpowers **/super build → /super qa → /super review**, test-first RED → minimal GREEN → refactor → retest. Documentation-only work needs link checks and independent review, not artificial failing tests.
4. For allowed local development/review with **Node 22+**, from repository root, run as relevant (no remote writes):

        npm ci --no-audit --no-fund
        npm run verify:source
        npm run build:frontend
        npm run build:owner-frontend
        npm test
        node scripts/check-project-docs.mjs
        npm run test:m01:browser
        node scripts/check-cloudflare-preview.mjs wrangler.preview.jsonc

   Run focused **real local Workerd/D1** and browser test suites from the changed module's CI/workflow, with isolated disposable fixtures, and check exact current-head GitHub Actions. Some Playwright tests require browser dependencies. Do **not** report these commands as already run by this audit.
5. Require explicit human/owner approval before merges, any live resource changes, hosted auth activation, Control/Shop D1 migrations, historical imports or production cutover. Keep Cloudflare Workers Builds as sole public shell deploy owner. **Cloudflare build minutes can be exhausted**; a paused build is not a code success or authorization to bypass guards. Verify current Cloudflare plan, actual deployment commit and logs rather than guessing.
6. At completion update this file's **dated SHA, module evidence row, open PR snapshot and next exact task**, link the issue and PR, state tests actually executed, list blockers honestly, and leave unresolved release gates checked only when independently signed.

### Known release gate and governance nuance

The 20 Nov read-only GitHub branch API returned **main.protected=true** and a repository branch ruleset named **SherERP Main Branch Protection** with **enforcement=active**, but the legacy branch-protection object still reported checks disabled. **Do not infer** actual required-review/check or environment enforcement from the label alone: verify the effective ruleset, required-check set, bypass rights and protected staging environment with proper repo administration access. The latest main commit had **no combined legacy status contexts** in the queried status endpoint; that is neither proof of CI pass nor CI failure. Inspect PR checks and Actions runs individually.

**Reference signoffs:** [clean-Shop objective #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690), [M03 #22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22), [M08 money policy #66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66), [PORT-00 #699](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/699), [M10 #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) and [M11 #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) remain unclosed coordination/acceptance issues as checked. No one should mark the **MVP** or **production** complete until integrated tests and signed release evidence actually change this decision.

