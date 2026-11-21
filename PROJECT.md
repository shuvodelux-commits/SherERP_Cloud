# SherERP Cloud — Project Status, Handoff & Task Board

## 22 November 2026 — fresh GitHub monitor snapshot (development only; no release authorization)

**Verified main:** `51178bb509a72ced6e42d872d5c3bc15ebf60301` (latest commit: M01 POS Customer Quick Add, PR #899). The repository default branch is `main`.

**Pull-request inventory:** GitHub Search API and the direct repository `GET /pulls?state=open` endpoint both returned **zero open PRs across all target branches** at 2026-11-22 01:32 Asia/Dhaka. Older active-PR tables and handoff snapshots below are historical; do not reuse them as a current queue. Recheck live PRs and exact heads before every task.

**Exact-main CI evidence:** the commit has one check run, `Workers Builds: shererp`, completed **success** (run/check URL: https://github.com/shuvodelux-commits/SherERP_Cloud/runs/136836347235). The Actions `workflow-runs?head_sha=...` query returned **zero workflow runs**, and the combined legacy commit status is `pending` with zero status contexts. Therefore the Cloudflare build is green, but complete current-main Node, Workerd/D1, accounting, auth, source and browser CI is **not independently certified** by this snapshot.

**Main protection:** active repository ruleset [SherERP Main Branch Protection, ID 27454206](https://github.com/shuvodelux-commits/SherERP_Cloud/rules/27454206). Required PR status contexts are `m00-audit`, `Fast PR confidence`, and `Verify source, Worker and safe preview configuration`; review-thread resolution is required and there are no bypass actors. The configured minimum approving-review count is zero. The monitoring policy remains stricter: obtain independent review and verify all applicable exact-head checks before any merge.

**Parallel-workstream gate:** coordination [issue #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456) and `docs/M03_PARALLEL_READINESS.md` remain authoritative. Parallel preparation is READY; parallel financial transaction-module implementation remains NOT READY. M03 is the sole integrator for shared `src/db`, migrations, `src/rpc`, Worker entry/bindings, stock/invoice IDs and atomic posting. M02 supplies reviewed source semantics; M04 supplies auth/session/RBAC contracts. Do not infer release readiness from parallel PR counts or green preview builds.

**Operational boundary:** this is a read-only GitHub snapshot. No live D1 read/write or migration, financial posting, Cloudflare Builds variable/secret change, Worker deployment, or Mohim_ERP source modification was performed or authorized by this entry. Production financial activation remains **NO-GO** pending the full M02/M03/M04, accounting, M10/M11, hosted authenticated acceptance and separate owner release gates.

**Next monitor action:** inspect newly opened PRs against their actual base/head, file ownership, dependency issues and exact-head full CI; resolve only safe failures using test-first GitHub branch commits. Merge only after independent review, protection and post-merge `main` file verification. Keep this dated section as the current GitHub snapshot; older dated handoffs remain historical evidence.

---

## 21 November 2026 — development builds no longer need a new production approval for each merge (opt-in PR)

**Owner decision:** SherERP is still an active *development/testing* Shop. Requiring `FIRST_SHOP_CORE_MVP_REFRESH` with an exact new approved GitHub SHA and D1 report for **every** code merge repeatedly blocks current HisabIQ UI deployment. The currently connected Shop D1 is nevertheless real and must remain isolated. A **separate opt-in** `SHERERP_FIRST_SHOP_CORE_RELEASE=DEVELOPMENT_AUTO` with one-time `SHERERP_DEVELOPMENT_CORE_CONFIRMATION=EXISTING_SHOP_CORE_VERIFIED` is being implemented under M11/M03. It preserves exactly the previously approved first-Shop core flags, both existing D1 bindings, Owner auth/rate limits and main-only Cloudflare Builds publisher; disabled finance flags remain OFF. It does **not** grant production GO, change remote D1 or call Wrangler deploy, and it does **not** bypass build/permission failures other than obsolete per-commit SHA/readiness requirements in this explicit development mode.

**Evidence before PR:** TDD 2 RED failures → targeted 29/29 GREEN; full Node **4,217/4,217** passed, Owner app build and source manifest **84/84** passed; local generated DEV candidate exactly matched current live binding/flag roster and remained identical across a simulated new main SHA. Strict Wrangler dry-run succeeded with no upload; local private files were deleted. This proves the local generator works, not that Cloudflare Builds Settings were modified or the live UI updated.

**Pre-release status:** At last verification, GitHub main `22a898c5bf5513d181c8d6a2925694cc0bd1cdba` includes merged #895/#896/#897, while the active Owner Worker was still the older `29e0fc49-74be-458e-bef1-3ab42546fc05` at 100% traffic. The previous 21-November read-only Shop D1 check verified 13 immutable receipts, Shop marker and approved Supplier overlay. The last Cloudflare Builds rejection code is **not independently retrieved** because the operator's Builds settings API previously returned 403; do not claim the pin is the only possible failure. The new feature requires source PR merge, exact-head CI, M03/M11 review **and then** an authorized operator's one-time change to Build variables. No development auto deployment happens merely because the PR merges. See `docs/runbooks/M03_SHOP_USER_CLOUDFLARE_BUILDS.md` for precise mode-switch and return-to-production procedure. Stop auto deploy and use the protected SHA-pinned mode once fully production approved.

## 21 November 2026 — M11 issue #884 protected Owner UI release preflight (NO LIVE DEPLOY)

**Current GitHub main:** `d3d77cc32cae83406dfe6383018a0c39cd06cc29` includes merged HisabIQ POS #893 and Party #894 (also Product/Sales/Settings/Shell). **Current live `shererp` Worker:** `29e0fc49-74be-458e-bef1-3ab42546fc05`, deployed 2026-11-21 **07:54 UTC**, still 100% traffic and older than both UI merges. This explains why the latest UI is not visible; GitHub merge alone has no Cloudflare deployment.

**Independent read-only checks on the active hosted single-Shop:** existing Control and Shop D1 bindings and Shop identity verified; all 13 migration receipts and approved Supplier Cash overlay match; Catalog/Product/Write Grant/Purchase/Cash POS core flags still true, Cash Return/Supplier Cash Pay still false; `productionReady=false`. Fresh Owner app `npm run build:owner-frontend` builds 2,074,861-byte `dist-owner/owner-erp.html`, immutable GAS source verifier 84/84 passes.

**Candidate release safety (M11):** a local approved SHA-pinned `FIRST_SHOP_CORE_MVP_REFRESH` candidate generated using the exact current live Worker binding roster and a newly gathered SELECT-only D1 readiness report was compared **in memory** to live version metadata: full asset/D1/rate-limit/text/flag parity `MATCHES_LIVE`, no disabled feature escalated, `authorizesDeployment=false`. Strict private Wrangler `deploy --dry-run` exited zero; local candidate was not deployed or promoted. An incomplete core refresh with saved approval/evidence but no release mode previously fell back to login-only config; a Superpowers RED→GREEN regression now makes it reject explicitly instead of potentially turning off Purchase/Cash POS. See `docs/superpowers/plans/2026-11-21-m11-owner-core-refresh-parity.md`.

**The next *operator-only* step:** verify Cloudflare Workers & Pages → `shererp` → Settings → Builds (previously 403 from current Wrangler OAuth). With explicitly authorized release and backed-up D1, set protected `FIRST_SHOP_CORE_MVP_REFRESH`, pin exact final merged `main` SHA, load fresh verified two-blocker D1 evidence and use **only existing Cloudflare Workers Builds** to publish. Verify Worker active version changes, identical Control/Shop DB identities, rate limiter/flags and signed-in Shop UI at 320/390/768/1024/1440. Do not manually `wrangler deploy`, reset variables, enable finance, run migrations, or claim production GO before M10/M11/two-Shop/accounting/security signoff. GitHub issue [#884](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/884) remains open until live authenticated acceptance.

## 21 November 2026 — M11 read-only hosted deploy diagnosis and protected Builds error codes

**GitHub baseline:** `main@090c5a4b00f240628c96cbbf319361d26bd24cfd` includes merged **PR #890** with all **83/83** PR checks passing. At the inspection no other PR was open. **The live Owner Worker still runs an older version**: Wrangler `deployments list --name shererp --json` shows active version `29e0fc49-74be-458e-bef1-3ab42546fc05` created/deployed 2026-11-21 **07:54 UTC** (100% traffic), whereas #890 merged at **08:57 UTC**. A merge is not a successful Cloudflare Builds deployment. Anonymous `/api/owner/auth/session` and `/api/owner/catalog` currently return **401** (auth protection), not proof of authenticated business success.

**Current live READ-ONLY D1 preflight:** both Control/Shop D1s bound; Owner auth and dashboard enabled; immutable Shop identity valid; all **13** baseline migration receipts and the reviewed Supplier Cash overlay valid. Core Catalog/Clean Product/Write Grant/Credit Purchase/Cash POS flags are **true**. Cash Return and Supplier Cash Pay flags are **false**, the two current readiness blockers. `coreReadConfigured=true`, `coreWriteConfigured=false`, `productionReady=false`. Separate remaining release checks: private multi-Shop publisher, authenticated two-Shop E2E, M10/M11 restore, complete original RPC parity and independent accounting/security review. No D1 SQL write, Worker publish, config/flag change, secret export, or new business record occurred during these checks.

**M11 scoped next fix:** On active-core Builds refresh the branch/commit and protected `SHERERP_FIRST_SHOP_CORE_RELEASE_COMMIT` must be the same 40-character SHA. A later merge cannot deploy automatically with an old pin. The generator has correctly failed closed but previously emitted only a generic configuration error, leaving release operators without a safe diagnostic. The scoped M11 branch `m11/owner-build-blocker-diagnostics-20261121` adds fixed safe reason codes to **unchanged rejection predicates** and suppresses all rejected values; this is diagnostics only, not a new automatic deployment path. Tests first failed because `.code` was absent; targeted release contracts pass after implementation. See `docs/superpowers/plans/2026-11-21-m11-owner-build-safe-errors.md` and the PR for latest CI status. M03 review is required for the shared `scripts/build-shop-user-deploy.mjs` path; M11 owns release verification. None of these code changes activates a financial writer.

**Next actual release operation (separately authorized):** In the existing production Cloudflare Builds configuration, confirm the protected refresh mode `FIRST_SHOP_CORE_MVP_REFRESH`, set the exact reviewed final `main` SHA as the release commit pin, and supply a **fresh read-only** readiness report for the active Worker/Shop. Follow the existing approved single-Builder release path; **do not** upload/promote via a competing Wrangler/manual deploy, reuse a stale readiness report, or enable Cash Return/Supplier Pay without reviewed gates. After approved build, read back live version/bindings/flags and signed-in Sales/Product/Purchase behavior. Unverified until actually performed. **Production GO/NO-GO: NO-GO.**

## 21 November 2026 — M01 Owner UI consistency: resume checkpoint (PR candidate)

**Scope/ownership:** Issue #690, M01 frontend-only branch `m01/owner-workflow-consistency`, based on `main@f91522739b1e40c9142516d2393718ab8f8f2a5f`. Local isolated worktree `/tmp/shererp-owner-ui`; implementation commit `7ec85ba1` (check current head and PR status before proceeding). The sole functional changes are to the existing Owner frontend builder, HisabIQ Party UI and companion CSS; no shared D1 schema, financial writer, Worker route, Cloudflare binding, release flag or production database is changed. Check [visual review and screenshot evidence](docs/reviews/m01-owner-workflow-consistency/README.md).

**Implemented:** Converged Product Add/Category/Unit controls and compact dialogs, first-focus and opening guidance in Party, and the Purchase flow onto the approved HisabIQ control palette/sizing. Removed a redundant Cash Session/Day Open card from Purchase; retain the topbar Cash Session action, source operation contracts, SQL-time cash gates and authenticated Shop isolation. Product new category/unit values are saved through an existing successful product save and become subsequent choices; standalone category/unit master operations are not newly enabled. Supplier Party creation remains zero-opening-only in this UI; other financial role writers remain blocked pending their independent account contracts.

**Verified locally on exact implementation branch after rebase:** `TZ=UTC node --test` **4,187 pass / 0 fail**; focused Chromium browser suites **28/28 pass**; real disposable Workerd/D1 Product → Supplier → Purchase → POS → Return desktop/phone and Party persistence suites **3/3 pass**; `npm run build:owner-frontend`, `npm run verify:source` (**84/84 frozen files**), `npm run docs:check`, JavaScript syntax and `git diff --check` pass. The screenshots visually compare before/after in widths **320/390/768/1024/1440**. Exact `/ui-refine-skill` was unavailable; manual screenshot analysis is disclosed in the review. These are **local** tests, not GitHub exact-head CI or signed-in hosted ERP acceptance.

**Resume steps:** Confirm fresh `origin/main`, new open PRs and file ownership; push the reviewed branch; open one scoped PR to `main` with this section, the four screenshot contact sheets and test evidence; wait for exact-head GitHub CI and reviewer clearance. After merge, independently verify the built Owner asset SHA, approved Cloudflare Workers Builds deployment and hosted authenticated screen before claiming the live UI has changed. Issue #690's full Owner RPC/Shop D1 connectivity, seven-role Party accounts, multi-Shop readiness, and M10/M11 production gates are **not** completed by this M01 UI PR. **No hosted deployment or remote D1 write is authorized by this checkpoint.**

## 21 November 2026 — live Control D1 `0012` and private Provisioner boundary (latest)

**Verified:** GitHub `main@71aabc8961c920f3c87ec1c7be4d069316e21c73`, with zero open PRs at this checkpoint. This live read-only audit supersedes older Control D1/Provisioner claims below; dated snapshots farther down remain historical. Evidence is tracked in [coordination #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456) and [Owner integration #690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690).

- **Live Control D1:** The deployed `admin` Worker `CONTROL_DB` and pilot `PLATFORM_PILOT_DB` bindings match distinct Cloudflare D1 database IDs. Reviewed `0012_hosted_shop_provisioning_journal.sql` **is already applied** on the Control D1. Read-only remote `sqlite_schema` confirms its one STRICT `platform_hosted_shop_create_journal` table and two exact immutability/no-delete triggers; `PRAGMA quick_check=ok`, `PRAGMA foreign_key_check` zero violations. Existing Admin, Shop reservation, binding, and provisioning records are intact (one each); journal rows zero. **Do not execute `0012` again.**
- **Recovery:** Encrypted pre-/post-`0012` Control D1 exports, AES-256-GCM backup keys in separate restricted local storage, Cloudflare Time Travel recovery bookmarks, and verified decrypted SQLite restore/rehearsal are retained on the authorized operator PC, **not in GitHub**. Never blindly restore an old bookmark over acknowledged production writes.
- **Private Provisioner:** Cloudflare reports Worker `shererp-provisioner` **does not exist** (API 10007); current Admin deployment has no `PLATFORM_PRIVATE_PROVISIONER` service binding and hosted D1 create permission remains off. Reused the merged private Provisioner generator to prepare a closed pilot config (`workers_dev=false`, `preview_urls=false`, only Control D1, `PROVISIONER_RELEASE_ENABLED=false`, database limit 10). `wrangler deploy --dry-run --strict` passed. **No Worker was uploaded, new Shop created, flags enabled, or live database written in this round.**
- **Already implemented; do not rebuild:** Admin Google+MFA, signed-in Business Directory read-only fallback (#849), first-Shop 13-receipt schema verifier, Supplier Cash SQL overlay 0010/0011, private Provisioner provider/bridge and profile generator, and Owner binding publisher *contracts*. Passing isolated contract tests does not prove hosted two-Shop provisioning.
- **Independent QA in this checkpoint:** 30/30 selected local Node contract and real Workerd/D1 integration tests passed across private Provisioner, Admin bridge, append-only creation journal, Owner binding publisher, two-Shop routing and two-Shop publication suites. The closed Cloudflare Provisioner config also passed Wrangler strict dry-run; neither result is authenticated hosted two-Shop acceptance.
- **Next actual blockers:** Independently review and install a disabled private Provisioner, Admin-only **service binding** plus matched internal secrets, the real remote Shop D1 13-step migration/identity executor, and the single shared Owner Worker binding publisher. Test live two-Shop Owner isolation and original Product → Purchase → FIFO Cash POS → Return → cash/ledger readbacks; then M10 restore/replay and M11 security/financial release signoff. Only approved release flags may be enabled after those gates. **Production MVP: NO-GO.**


> **Single operational entry point for the active project.** This is a dated status snapshot and handoff, not permission to deploy or change data. For the latest truth, re-check GitHub main, open PRs, issues, checks and the authoritative architecture/release documents linked below.
>
> **Snapshot:** 2026-11-20 (Asia/Dhaka) · verified GitHub main `5a18e1d5cbaf89c5ca65f69243e5af43db2b28c2` · **MVP: IN PROGRESS** · **Production: NO-GO**. The following is a merged-code QA audit, not a hosted transaction acceptance test.
>
> **Original source of business truth:** [Mohim_ERP](https://github.com/shuvodelux-commits/Mohim_ERP) at pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Do not modify legacy GAS or its source data without a separate approved migration/cutover.

## Issue #690 Owner ERP integration

**2026-11-21 Sales Invoice checkpoint.** The live Owner Worker version `65883523-0a33-4247-9870-8d2768f92368` has distinct Control and Shop D1s, matching Control placement and Shop marker, and the required Sales/Return tables. The original Sales list RPC terminates in the Owner browser allowlist and the pre-change Worker has no Sales history route. The global banner is inserted unconditionally and the legacy session field is hard-coded false. The private M03 Sales candidate connects the original screen to scoped list/detail with exact cash invoice and return history, retryable errors, and a separate successful-empty state. The compiled shell reports the verified storage placement at sign-in. Bank payments and Sales mutations require separately reviewed integration. Hosted authenticated browser acceptance and production release remain pending. [Read-only evidence and updated RPC matrix](docs/owner-mvp-rpc-matrix.md#sales-invoice-integration-update-for-690)

The [RPC inventory](docs/owner-mvp-rpc-matrix.md) covers the original screens and the Owner routes at the audit baseline. This batch connects Suppliers → Actions → View to the existing Shop-scoped purchase ledger. Its balance includes all posted credit purchases, and the modal displays up to 50 recent entries. Counter payments, broader Party statements, staff access and automatic multi-shop readiness still require integration and release verification.

## 20 November 2026 — hosted Admin first-run deployment handoff (newest)

**Verified GitHub source:** `main@0b12f021fa3024ff09feff0aa82a63e62232b806`, including first-Admin browser setup PR #814 and hosted directory PR #813. Local Workerd/D1 first-run and Accessless auth regressions passed. These are **not** real Google/browser activation evidence.

**Deployment performed:** The new Cloudflare account's Worker `admin` was updated from Hello World to the private Accessless Google/TOTP Admin entry at `https://admin.hisab.workers.dev` (deployed version `2ca6e483-f996-44e7-bdc0-10a6c6add570`). A **separate empty Control D1**, `shererp-admin-control-v2`, received the reviewed platform-auth migrations 0001–0004. The previously enrolled `shererp-control` D1 remains intact and unmodified. The Worker has a per-minute rate limiter and no Shop data bindings, financial API, reservations or dynamic provisioning enabled.

**Current LIVE state: Admin authentication ACTIVE; tenant controls still disabled.** The operator installed both Cloudflare secrets and completed first-time Google/TOTP activation via the browser. Read-only remote D1 verification shows one immutable first Super Admin and one enabled MFA factor. `GET /` returns 200; `GET /api/platform/wizard` returns `{"setup":false}`; an unauthenticated session returns 401, and unexpected API query parameters return 400. The Admin Worker was updated to version `bfe01332-5177-428c-8cfc-51031dbd4bd6` using the PR #817 minimal signed-in Control Center overview, while retaining the same Control D1 and secrets. The UI now explicitly reports that the directory and hosted shop provisioning are not enabled instead of showing only Sign out. No Google credentials, TOTP factor, enrollment secret or authentication cookie was sent to GitHub or chat. The original ERP remains NOT production ready; see [START_HERE.md](docs/installation/START_HERE.md) Step 12.

**Remaining:** Independently verify hosted sign-out, wrong-Google denial and token/session revocation; separately reviewed Control Center onboarding schemas and a real Shop D1 provisioner; authenticated Owner/ERP financial loop and M10/M11 release gates. The original ERP and public Worker remain **production NO-GO**. Do not silently rebind the Admin to the old, partially enrolled Control D1 or claim this staging deployment restored that identity.

## 20 November 2026 — current merged-code integration audit (no-repeat QA)

**No-rebuild decision.** Do **not** recreate the original ERP UI, POS V2 cart, FIFO, Purchase, Returns, Party, Cash/Bank or report algorithms merely because an operational browser/API route is missing. Reuse their merged modules and test evidence. As of audited main above, GitHub has **zero open PRs**; [#795](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/795), [#797](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/797), [#798](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/798) and [#799](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/799) are merged. Older open-PR snapshots farther down this file reflect their original dates, **not** current state.

| Current source-of-truth evidence | Precise classification | Smallest next acceptance |
| --- | --- | --- |
| [Private Owner Worker](src/m03-owner-redemption-worker.js) routes Product catalog, Supplier, Purchase bootstrap/detail/history/posting, and Cash Session under explicit flags; [Shop Purchase implementation](src/db/m03-owner-mvp-purchase.js) is SQL-time Owner scoped | **Implemented and routed** for opt-in clean Shop D1; Purchase intentionally limited to same-day, unpaid, zero-discount, base-unit credit | Real authorized Owner and separate Shop readback, current flag/lease/tenant/Cash Session verification; no inference from public Worker |
| [Owner frontend builder](scripts/build-owner-frontend.mjs) maps original createPurchase, Purchase reads and Start Day to corresponding private Owner APIs with retry operation ID | **Original Purchase screen integration exists**; do not redo | Prove the original UI → current private Workerd route → persisted Purchase/Lots/Supplier due → reload on a clean Shop |
| [Original POS converter](src/modules/mvp-pos-v2-sale-intent.js), merged [#792](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/792)/[#797](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/797), and [M06 Workerd tests](tests/integration/mvp-pos-v2-source-to-d1-workerd.spec.mjs) | **POS adapter implemented**, but M06 Workerd posting uses a **synthetic test fixture**, not the operational Owner Shop D1 writer | Reuse existing POS adapter, FIFO helpers and exact-money proofs; integrate **only** a missing current-Owner, current-Shop Sale route + SQL atomic receipt/write/readback |
| [Owner Worker](src/m03-owner-redemption-worker.js) route map has no Sale or Sale Return endpoint; [Owner builder](scripts/build-owner-frontend.mjs) source RPC mapping has no completeSale handler | **Confirmed missing integration**, not evidence that all Sale/Return algorithms are missing | Under exclusive M03 shared writer ownership, test-first bridge original POS completeSale to authenticated SQL-time Owner/Shop/Cash Session/FIFO/payment/receipt with exact persisted full invoice; fail closed on unsupported modes |
| [Owner browser QA](qa/m03-owner-erp-browser.spec.mjs) uses mock HTTP handlers for Product/Purchase | **Browser UI fixture passed independently of real hosted D1**; cannot certify actual POS checkout | Real local two-Shop Workerd + original browser integration, then *authorized* hosted acceptance with reload/print and cross-shop denial |
| [Public Worker](src/index.js) declares database not-connected; [public RPC registry](src/rpc/registry.js) deliberately empty | **Public shell intentionally fail closed**; this is not a live production ERP | Keep public previews D1-free; never bind financial data or enable public RPC just to bypass an integration blocker |
| [M10 rehearsal #312](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/312) and [M11 release #306](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/306) acceptance checklists remain unchecked | **Production NO-GO** | Private source verification/reconciliation, backup+restore with acknowledged-write replay, security/performance/CI controls, separate owner release approval |

**MVP-first no-duplication sequence:** (1) one authorized M03+M06 Owner Sale bridge reusing existing modules and actual D1 stock/payments, starting with one Standard SKU and one supported tender; (2) connect M07 Return/reversal and M08 gross ledgers to the *same* writer; (3) verify M01/M09 original invoice print and reports from reloaded posted data; (4) verify two clean tenant Shops with Owner isolation; (5) M10/M11 independent hosted recovery and release gates. Follow /super build → /super qa → /super review for **actual confirmed missing work**. M03 owns Worker/routes/src/db/migrations; other workstreams must avoid parallel edits to that surface.

**Audit limitations:** GitHub merged code, route maps, current source adapters and test implementations reviewed. **Not performed:** hosted authenticated ERP transactions, private D1 readback, real migration/restore, current Cloudflare deployed-commit comparison, release signoff, or any production mutation. Green isolated CI cannot substitute for those tests.

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
| M03 shared Worker/D1 kernel | Two-shop Owner→Product [#742](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/742), local Cash Session proof [#752](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/752), local first purchase proof [#758](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/758), and private clean-shop Supplier Quick Add [#791](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/791) merged; operational credit Purchase [#795](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/795) is merged | Selective private Owner features exist; full authenticated financial loop and approved shared writer/public activation are **BLOCKED** |
| M04 auth/authorization | Local D1 Google/Owner session, POS permission and SQL-time authority tests | Staging/production end-to-end authenticated transaction gate remains to be signed off |
| M05/M06/M07 inventory/POS/returns | Source-parity, isolated Workerd/D1 FIFO, sales and reversals; [#792](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/792) merged a **nonposting** original POS V2 one-SKU intent contract; merged [#797](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/797) tests original cart price/stock compatibility | Original POS V2 → real authenticated Shop D1 posting, full split tender/multi-unit/Tiles and native purchase→sale→return remain to be accepted |
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

**Suggested one-line next task (after #795/#797/#798 merges):** “Review the current merged code and verify that original POS completeSale is not mapped to an operational Owner API. Reuse M06 POS adapter plus the existing source/FIFO/finance helpers; implement only the missing **authenticated real Shop D1 Sale connection** under the designated M03 writer owner. Test one persisted Standard SKU Sale, current actor/Shop/Cash Session/stock/price, retry/idempotency, atomic rollback, full invoice readback, then source Return/reversal, accounting and original print. No duplicate Sale engine, remote D1 deployment or public RPC activation.”

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
- **Reference lineage:** legacy original [legacy Config.gs](legacy/source/Config.gs) is a byte-pinned set of 47 .gs and 37 frontend source files from Mohim_ERP commit **29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2**. The 49 source data groups have inventory/mapping evidence, not an approved complete private historical import.

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

