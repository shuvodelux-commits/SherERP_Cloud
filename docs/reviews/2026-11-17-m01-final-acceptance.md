# M01 — final independent frontend acceptance and integration handoff

**Date / scope:** 17 November 2026 — M01 original HTML/CSS/JS frontend build, Worker static shell, mobile/desktop/POS V2/browser and print QA.  
**Decision:** **Independent M01 frontend QA evidence is sufficient for scope-limited acceptance, conditional on this Run 3 PR passing all exact-head CI checks, owner review and merge into `main`.** This is **not** approval for live ERP transactions or production release.  
**Workstream:** [M01 issue #25](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/25), [parallel board #456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456), [rules](../PARALLEL_EXECUTION.md), [register](../WORKSTREAMS.md).  
**Audited integration baseline:** `SherERP_Cloud/main@3b02e509cd417ce2c32f590c0e1ab24c30532d5a`.  
**Frozen original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, [source manifest](../baseline/source-manifest.json); original `legacy/source/**` and Mohim_ERP were not modified by Run 3.  
**M01 Run 3 owner paths:** this document and [Run 3 plan](../superpowers/plans/2026-11-17-m01-run3-acceptance-handoff.md); documentation-only, no source, compiled runtime, `src/db`, migrations, `src/rpc`, `src/index.js`, CI configuration, financial writer or Worker binding change.

## 1. Acceptance decision with attributable evidence

The M01 definition of done in `docs/WORKSTREAMS.md` requires a frontend shell that loads without Google Apps Script, preserved original DOM/navigation, mobile and desktop behavior, print tests, and controlled rather than false-success API errors. These are the requirements for **M01 independently testable QA**; they are not a substitute for business-module user journeys once M02–M09 integrate real source records.

| M01 acceptance requirement | Evidence on merged code / real GitHub checks | Scope-limited result |
| --- | --- | --- |
| Frozen original UI source and reproducible frontend include build | `docs/baseline/source-manifest.json` pins Mohim source SHA; `npm run verify:source`, `npm run build:frontend`, original include/DOM checks in `tests/m01-ui-contract.test.mjs`; [Run 2 source/Worker/preview check](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445107/job/133977853496) | **Accepted in CI for frozen source/build**, not a deployed business app |
| Original desktop sign-in, shell lock and login input/keyboard behavior | `qa/m01-browser.spec.mjs`: desktop/mobile layout, 320/375px widths, Enter/Show-Hide, pending duplicate submit, bad profile, token mismatch, failed shell bootstrap | **Accepted in synthetic/public-inert Chromium QA** |
| Role-filtered menu, unauthorized navigation and POS V2 operational page | `qa/m01-landscape.spec.mjs`, `qa/m01-posv2-compiled-visibility.spec.mjs`; [permission CSS integration #494](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/494), [responsive QA #476](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/476) | **Accepted for presentation/visibility**; real business authorization remains M04/M03 |
| Source phone/landscape/tablet responsive behavior | [Run 2 #516](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/516), 375×812 → 812×375 → 768×1024 → 320×640 in one synthetic logged-in browser; touch and viewport metrics, restricted Bank and Products-add | **Accepted in synthetic browser QA** |
| POS V2 tabs, product-search keyboard fallback, no accidental checkout | [Keyboard/navigation #499](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/499), `qa/m01-landscape.spec.mjs`: Enter tab activation, ArrowDown/ArrowUp/Enter no-match, Escape clearing, zero sale-posting RPC | **Accepted for UI interaction without a sale**; stock/payment posting not tested |
| A4 invoice pagination and CSS print media | `qa/m01-browser.spec.mjs`, `qa/m01-invoice-edge.spec.mjs`, `tests/m01-ui-contract.test.mjs`: A4 physical PDF pages; 0/24/48/72 and 1/25/49 item boundaries, header repeat, non-splitting rows, escaped markup | **Accepted in Chromium PDF/CSS tests**; not verified on a physical printer |
| 58mm/80mm thermal, draft, long receipt and JPEG output | `qa/m01-browser.spec.mjs`, `qa/m01-thermal-long.spec.mjs`, `qa/m01-jpg.spec.mjs`: narrow formats, multi-page paper, paid/draft display, JPEG dimensions and download | **Accepted in Chromium/virtual browser**, not printer hardware |
| Repeated dialog cancellation and temporary DOM cleanup | [Run 1 #500](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/500), `qa/m01-print-flow.spec.mjs`: A4 → cancelled 58mm → 80mm → A4, phone/desktop, print-host cleanup, auth lock, zero financial RPC | **Accepted in simulated print-dialog QA** |
| Public endpoint failures do not look like valid ERP sessions | `src/index.js`, `src/rpc/registry.js` and `qa/m01-rpc-failclosed.spec.mjs`: `/api/health` foundation / database not connected; malformed/unsupported RPC, wrong Origin, bad response shape, locked browser on failure | **Accepted fail-closed foundation**, explicitly *not* live RPC |
| Local-only actual D1 security/browser handoff | `qa/m01-auth-browser-local-d1.spec.mjs`, `qa/m01-daybook-local-d1.spec.mjs`; both are isolated Workerd/D1 testing routes behind opt-in fixtures | **Accepted for tested local read/auth boundaries only**, not deployed public integration |

### Exact-head CI evidence — already merged Runs 1 and 2

| Work package | GitHub evidence | Result |
| --- | --- | --- |
| Run 1 print lifecycle | [PR #500](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/500), merged `9d11779310a94213b5803433f974d0cdd9288abf`; [Chromium run #44058433820](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44058433820) | **52/52 exact-head GitHub checks passed; 72/72 Chromium browser tests passed** |
| Run 2 same-session viewport cycle | [PR #516](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/516), merged `dca77cc46adbe0227f2f4888f303aedaee7da409`; [Chromium run #44065445027](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445027) | **52/52 exact-head GitHub checks passed; 77/77 Chromium browser tests passed** |
| Run 2 additional isolated browser cases | [Same Chromium workflow](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445027) | **1/1 Day Book Workerd/D1 test and 2/2 M04 browser auth tests passed** |
| Original permission CSS/viewport chain | [#494](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/494), [#476](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/476), [#499](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/499) | Merged onto `main`; regression code continues to run in Run 2 Chromium |
| Foundation/source/preview safety | [Source/Worker/preview check](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445107/job/133977853496), [isolation policy](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445381/job/133978691822), [Chromium run](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445027) | All passed on Run 2 exact PR head |

**Important evidence qualifier:** these CI results apply to the specified merged PR heads, not automatically to all subsequent unrelated commits on `main` or to this Run 3 branch. Run 3 must pass its *own* exact-head required checks before the final review can be merged. Run 3 makes no executable changes, so documentation-only review is exempt from inventing a new failing RED test; the test-first behavior-change evidence is in its referenced PRs.

### Screenshot and artifact traceability

The Run 2 [Chromium workflow #44065445027](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44065445027) published `m01-browser-evidence` (GitHub artifact ID `14319657840`, approx. 2.12 MB). At review the artifact was **present, not expired** and had recorded expiry **2026-11-24 10:32:24 UTC**. Screenshots generated from M01 tests include the four named Run 2 viewport stages and original print/login flows; reviewers should open the artifact while retained. Expired GitHub artifacts are not evidence that the tests no longer work; reproduce by rerunning the same M01 browser workflow on reviewed code, preserving the dependency and source pin. Avoid embedding customer/business data: screenshots use synthetic Clerk/invoice payloads.

## 2. Fail-closed Worker contract and tested limitations

On this baseline, the public Worker `src/index.js` handles GET `/api/health` with `{status:"foundation", service:"shererp-cloud", database:"not-connected"}`; `src/rpc/registry.js` is intentionally empty. The public `/api/rpc` handler must reject unsupported methods and never quietly simulate a successful sale, login, settlement or stock mutation. The preserved original browser uses a generated same-origin fetch adapter rather than live `google.script.run`. The M01 test server may inject **explicit local-only** M04 auth/Day Book adapters; those tests do not activate live Workers D1 bindings.

No M01 evidence proves a complete authenticated sale with concurrent FIFO stock decrement, split tenders, Customer/Supplier/Finance account movement, cash-session guard, returns/reversals, stock and profit reports or migration of real business data. Do not reinterpret browser-only role menus as SQL-time authorization. Do not issue invoices on live financial data from this intentionally inert shell. No external thermal printer, real cash drawer, USB/Bluetooth bridge, receipt paper feed or owner's physical device has been tested in this evidence set. Those require separately scoped device/production validation.

## 3. M03 and downstream integration handoff — blockers remain open

| Dependency owner | Required future integration evidence | Blocker disposition |
| --- | --- | --- |
| **M02 / M02-P** | All source groups, original IDs and historical ledger/gross Party-role accounts imported and reconciled without auto-linking by name/phone | **Outside M01; required for production** |
| **M03** | Awaited source-to-D1 repository/RPC closure, one atomic stock/ledger posting kernel, stable invoice IDs, idempotent retry/replay and exactly-once reversal; own all `src/db/**`, shared migrations, `src/rpc/**`, Worker entry and bindings | **Single integration owner; no M01 writer** |
| **M04** | Authenticated server-side actor authority and session revocation/role checks enforced at the same D1 mutation; fail closed for unauthorized operations | **Backend/public contract integration pending** |
| **M05 / M06** | Source-faithful Products/Units/Tiles Box/Pcs/Sqft, FIFO lots, purchase and POS checkout with tender/Cash Session and real protected writes | **Integrated business E2E blocked** |
| **M07 / M08** | Original-lot returns, native edit/delete correction and exact-once financial reversal; independent Cash/Bank/Party-role account reconciliation | **Integrated reversal/ledger E2E blocked** |
| **M09** | Settings/Reports/Day Book displays reading fully reconciled real migrated data with source visibility and authorization | **Integrated report E2E blocked** |
| **M10 / M11** | Approved deterministic source migration rehearsal, backups/restore, operational review, live devices, production deployment/cutover gates | **Not M01 sign-off; owner-controlled launch** |

Source of truth for status is the latest [M03 parallel readiness gate](../M03_PARALLEL_READINESS.md) and [parallel execution rules](../PARALLEL_EXECUTION.md), which currently allow **parallel preparation** and isolated tests but do **not** grant public financial transaction writers or live ERP release permission. M01 shall not alter shared D1/posting/auth files to remove that blocker.

## 4. Review checklist and closeout protocol

- [x] Run 1 #500 and Run 2 #516 actually merged to `main`; their exact PR head full CI and Chromium evidence verified.
- [x] Original source pin, M01 owned files, browser test inventory, API fail-closed semantics and screenshot artifact were inspected.
- [x] Existing merged M01 regression suites cover original shell, navigation, responsive viewports, POS V2 interaction, print and synthetic role restrictions.
- [x] No M01 Run 3 production/runtime change or shared-file write; documentation-only Superpowers exception applies.
- [x] Backend-dependent flows are explicitly **not** accepted or mislabeled as tested.
- [ ] **This Run 3 PR:** all exact-current-head required GitHub workflows successful, no conflict or hidden changed path.
- [ ] **Owner review:** approve/merge the Run 3 documentation PR to `main` and verify this file exists at the new main SHA.
- [ ] **M01 issue #25:** mark independent frontend QA scope accepted with a GitHub comment linking final main SHA and evidence; leave shared ERP production integration gates open.

**Decision after remaining three checks above:** M01 isolated frontend build/shell/browser/mobile/printing QA may be declared **COMPLETE**. The overall ERP and real checkout/accounts integration remain **NOT PRODUCTION-READY**, independent of M01 sign-off.

**Rollback:** revert this report and its plan only; original source, runtime, D1/Sheets, Cash/Bank, stock and production bindings are unchanged.
