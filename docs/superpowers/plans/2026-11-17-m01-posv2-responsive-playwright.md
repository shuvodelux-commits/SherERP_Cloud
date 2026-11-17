# M01 / #25 — Preserved POS V2 responsive browser parity

**Main base:** `1f068fc3c30c625446c560364fb872ae68cb8bc1` (verified PR #472 merged).  
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `UI.gs`, `pos.html`, `posv2.html`, `javascript.html`, unchanged.  
**Coordination:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, issue #456; existing M01 issue #25.  
**Owner:** M01 UI/browser QA.  
**Affected paths:** `qa/m01-landscape.spec.mjs`, `qa/m01-auth-nav-fixture.mjs`, this M01 plan.  
**Dependency:** merged M01 #457 and #472 auth/nav QA. No new backend or M03/M04 integration dependency.  
**Runtime/RPC scope:** test-only intercepted synthetic `login` and `getAppShellData`, existing inert public Worker for all other RPCs. No SQL tables/DDL or real business mutations.  
**Merge order:** one M01 PR against `main` after exact-head 100% full CI, owner/review gate and conflict recheck.

## Owner-approved M01 12-sentence overview and execution

1. Preserve the original source DOM, POS V2 layout and legacy POS operational functions without modifying them.
2. Add Playwright Chromium QA to the existing `qa/m01-landscape.spec.mjs` already invoked by the mandatory M01 workflow.
3. Verify a synthetic Clerk with `dashboard,pos` permissions can reach only the real POS V2 route, never a Classic POS presentation.
4. Exercise the source's mobile POS bottom navigation at a narrow 320×640 touch viewport.
5. At 768×1024 tablet and 1280×800 desktop, exercise the corresponding original sidebar navigation.
6. Assert the visible POS page uses `currentPage === 'posv2'`, `body.pos-v2-active`, and the real `#page-pos` operational DOM.
7. Test the source-generated Cart/Customer/Payment tabs using actual Playwright taps on mobile, including their active state.
8. Check that the original POS search input and Drafts button are operable without leaving the authorized page.
9. Ensure the Clerk without Product add permission cannot see the privileged Add Product action.
10. Confirm denied Bank navigation falls back to Dashboard and the browser never posts a sale merely by opening the POS page or changing tabs.
11. Capture synthetic mobile, tablet and desktop screenshots as CI review evidence.
12. First commit the tests with an unconfigured synthetic POS role (RED), then minimally allow M01's existing synthetic fixture to accept explicit role/nav overrides (GREEN), run all GitHub tests and leave the PR unmerged until full CI succeeds.

## No shared ownership or release activation

No changes to `legacy/source`, `frontend/raw`, `src/db`, `migrations`, `src/rpc`, `src/index.js`, M03 shared posting, M04 auth, cash-session policy, Cloudflare bindings/workflows or real business data. This is **presentation-only QA**, not a claim that live products, stock, checkout or split tenders are enabled. No deployment of live ERP functionality; public RPC registry remains empty. If the test reveals an actual source/UI defect requiring a global frontend change, open a coordination issue and wait for the shared integrator rather than changing protected files here. The test-first RED is about the **missing synthetic role-configuration fixture capability**, not a production security bug. No original source bytes are copied/transformed.
