# M01 HisabIQ Sales UI visual review — 2026-11-21

**Status: review candidate. Real local Workerd/D1 Sales reads, Cash Return and tenant isolation verified; hosted production deployment remains unverified. Not full HisabIQ module parity.**
**Reference UI:** `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`, `src/pages/Sales.tsx`, `SalesWideToolbar.tsx`, `SalesMobileLayout.tsx`.
**Target base:** `shuvodelux-commits/SherERP_Cloud@d740dcf0`; candidate SHA recorded in PR. The Owner ERP is rendered using compiled HTML and its **existing** authenticated D1 read adapter and native mutations.

## Evidence matrix

| Browser | Before | After | Reference |
|:--|:--|:--|:--|
| 320 × 900 phone | [before](images/320-before.png) | [after](images/320-after.png) | compared with reference 390 |
| 390 × 900 phone | [before](images/390-before.png) | [after](images/390-after.png) | [HisabIQ 390](images/reference-390.png) |
| 768 × 900 tablet | [before](images/768-before.png) | [after](images/768-after.png) | responsive source implementation |
| 1024 × 900 desktop split | [before](images/1024-before.png) | [after](images/1024-after.png) | responsive source implementation |
| 1440 × 900 desktop | [before](images/1440-before.png) | [after](images/1440-after.png) | [HisabIQ 1440](images/reference-1440.png) |

Reference screenshots are from the local Vite preview at `http://127.0.0.1:4421/#/app/sales` pinned to `hisabiq_ui@e42a00a`. Before and after are the **same** SherERP Owner compiled build with only this Sales enhancement removed/added. All Owner screenshots use **isolated synthetic test invoices** (no live Shop data). Captured by headless Playwright Chromium with reduced motion and full-page screenshots. Screenshots are not evidence of real D1 production connectivity.

## Visual comparison and corrections

1. **Wide desktop:** Initial compiled preview had vertically stacked filters despite the HisabIQ compact toolbar. Refined the existing touch date/select proxy controls to a single 36px row; preserve original select values/handlers.
2. **Mobile:** The existing legacy card styling rendered every field and made cards very tall. Changed to a compact Invoice/status/customer/total/due summary, adding a keyboard-accessible **More details** disclosure for paid/return/profit and other optional fields.
3. **Mobile summary:** Instead of four bulky cards, default to billed/due values and allow users to expand the other two. Values originate only from loaded invoice rows.
4. **Native route parity:** Added the HisabIQ-style Sales tabs only from existing **permitted** Owner Sales child routes. Never create a fake Customer Credit or unimplemented native route. Render separate native Sales Return, Return History and Drafts screens unchanged.
5. **Table density:** 36px controls, Geist/Hind Siliguri text, ink/teal colors, compact header/body, reduced-motion affordances, native sticky row-action menu, loaded invoice badges, pagination and sorting. All native invoice ID anchors and row-action handlers survive.
6. **Financial provenance:** No React preview fixtures are imported into production. No D1, schema, Worker, RPC, ledger, Cash Book, auth, role or Shop binding code is changed.

## Tests executed

| Command | Result |
|:--|:--|
| `node --test tests/m01-hisabiq-sales-ui.test.mjs qa/m01-hisabiq-sales-browser.spec.mjs` | **15/15 passed**: source guard, compiled Owner, five viewport layouts, search, filters, column menu, sorting, native invoice IDs, pagination, keyboard actions, mobile details, authorized tabs |
| `H_SALES_BASELINE=1 node --test qa/m01-hisabiq-sales-browser.spec.mjs` | **10/10 passed**; five before screenshots generated |
| `npm run build:owner-frontend` | Passed; compiled Owner ERP includes Sales assets |
| `npm run verify:source` | Passed; 84 frozen original files unchanged |
| `npm run docs:check` | Passed |
| `node --check src/ui/hisabiq-sales.js` | Passed |
| `node --test qa/m03-mvp-cash-return-browser.spec.mjs` | **Passed against disposable real Workerd/D1:** actual Sale list, detail, Cash Return, exact one receipt, Shop B denial, post-return re-read, cash/stock ledger |
| `node --test --test-concurrency=2 qa/m03-first-shop-complete-journey-workerd-browser.spec.mjs tests/integration/mvp-first-shop-http-lifecycle-workerd.spec.mjs tests/integration/m10-operational-owner-sale-parity-workerd.spec.mjs` | **9/9 passed:** complete Original ERP Product→Supplier→Purchase→POS→Return, Shop D1 historical list, isolated and actionable API failures, FIFO Cash Book and stock reconciliation |
| Local dependency repair | The checkout initially lacked `hono` and `wrangler`; provisioned local test dependencies without changing tracked package manifests or Worker runtime and re-ran the real-D1 tests successfully |

TDD: first `node --test tests/m01-hisabiq-sales-ui.test.mjs` RED on missing `scripts/patch-hisabiq-sales.mjs`, followed by 5/5 GREEN; mobile disclosure test independently RED before compact UI changes, then GREEN.

## Remaining differences and release gates

- Reference desktop list includes **Items**, full payment-method details, Customer Credit and certain transaction types not available from the existing D1 Sales **list** response. Do not manufacture information; show any actual extended details via the original invoice detail when supported. Native Invoice Detail remains in legacy layout, so exact React modal parity has not been reached.
- Remaining native Draft, Return, Return History, customer/Party and invoice/print subpages are not redesigned in this single M01 list UI PR. They retain existing permissions and behavior. Additional visual parity work is required.
- **Functional connection verified in disposable real D1:** source Sales `serverCall('getSalesManagementList')` → authenticated Owner `GET /api/owner/sales` → Shop-scoped `readOwnerSalesManagement`, and `getSaleDetail` → `GET /api/owner/sales/:invoiceId`. A real FIFO Cash Sale appears in the redesigned list and detail, the Cash Return posts once, and a subsequent list/detail read returns `returnedAmount=75`, `netSale=75`, `profit=15` and `Partially Returned`. An Owner session from Shop B cannot read Shop A, and its Cash Book/lot receipt records remain separate. **This is local test D1; not production D1.**
- The `/ui-refine-skill` and `/ui-refine-loop` commands were **not available** among the installed agent skills; do not claim they were invoked. Used the mandated fallback of direct reference inspection, Playwright before/after screenshots, visual comparison, iterative CSS/JS corrections and reruns.
- PR #888 initially failed **M03 MVP operational Cash Return — private Workerd D1 only** because the old browser test clicked hidden `#subNav .tab-btn` rather than the new permission-checked Sales Return tab. Fixed the test to click the visible reference tab, retaining native fallback; both real D1 browser test and stronger Shop-isolation/read-after-return assertions are now locally green. Latest GitHub CI, code review, merge approval, release pipeline, and **post-merge production Worker authenticated Sales smoke** must still be explicitly verified. This PR does not authorize release, financial migration, or removal of the legacy Sales page.
- `PROJECT.md` requires updating only after this review milestone is accepted; do not overwrite parallel workstream handoff while its maintainer is active.

## Scope inventory

- **Additional adjusted QA:** `qa/m03-mvp-cash-return-browser.spec.mjs`; tests the existing authenticated Worker–Shop D1 path and reads the actual Sales UI, without changing financial writers.
- **Created:** `scripts/patch-hisabiq-sales.mjs`, `src/ui/hisabiq-sales.css`, `src/ui/hisabiq-sales.js`, `qa/m01-hisabiq-sales-browser.spec.mjs`, `tests/m01-hisabiq-sales-ui.test.mjs`; review, spec and plan.
- **Modified:** `scripts/build-frontend.mjs` one optional compiled-only injector.
- **Original GAS/legacy:** exact byte-level copy preserved; `legacy/source/` unchanged.
- **RPC:** none. **D1:** none. **Financial writes:** none. **Shop/tenant authorization:** unchanged, original routes and Owner session remain authoritative.

## Production activation boundary (not part of this PR)

The currently reviewed Cloudflare Owner Worker uses `scripts/build-shop-user-deploy.mjs` and the exact main release-SHA/build-variable gate. The actual site `https://shererp.hisab.workers.dev/app` will only show these Sales changes after an approved `main` merge, successful Workers Builds release and readback of the deployed version. The first-Shop core functionality is behind explicit production release configuration; the user-facing Worker must preserve Control D1, Shop D1, matching marker, existing Google Owner sessions and Shop binding. **Do not modify live D1, switch business bindings, or turn on finance flags from this UI PR.** See `docs/runbooks/M03_SHOP_USER_CLOUDFLARE_BUILDS.md` for the independent owner-controlled release gate.
