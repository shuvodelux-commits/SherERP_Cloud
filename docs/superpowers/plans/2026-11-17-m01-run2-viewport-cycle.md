# M01 Run 2 / #25 — authenticated POS V2 responsive viewport cycle

**Workstream:** M01 original UI/mobile/printing/Playwright QA.  
**Coordination:** AGENTS.md, docs/PARALLEL_EXECUTION.md, issues #25 and #456.  
**Base:** `main@96e464a5c4172608a27e1331c8e963af2f02c54e` following merged #500.  
**Original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, strictly read-only.  
**Owner:** M01; modified `qa/m01-landscape.spec.mjs`, new `qa/m01-viewport-cycle-fixture.mjs` and this plan.  
**Runtime:** local compiled original UI in Playwright Chromium with existing M01-only synthetic Clerk/shell fixture, not public authenticated Worker or production POS.  
**Dependencies:** merged #494, #476, #499, #500; M03 integration remains owner of public RPC and shared source-to-D1/posting.  
**Read/write scope:** test-only browser viewports/screenshots and static synthetic test data; no financial mutations, D1 SQL, src/rpc, Worker, CSS, legacy/source or auth code.  
**Merge order:** one M01 PR against main; record actual RED and GREEN separately; full exact-head Playwright and all required GitHub checks; review then merge and verify source files on main.

## Run 2 design and acceptance (12 sentences)

1. The original source's phone predicate treats narrow portrait and coarse short landscape as phone layouts, but a taller touch tablet uses the desktop shell.
2. Existing M01 Playwright tests already exercise these layouts in isolated browser sessions and confirm the POS V2 operational page is `#page-pos`.
3. A gap remains for one authenticated Clerk session repeatedly transitioning between those viewports without a page reload.
4. Add one independent browser test to the existing M01 Chromium suite rather than modify production UI.
5. The sequence must cover 375×812 portrait phone, 812×375 coarse landscape phone, 768×1024 touch tablet, then 320×640 compact phone.
6. Start with the existing M01 synthetic Clerk allowing only Dashboard and POS, explicitly denying Bank and Products-add.
7. Authenticate once, enter POS V2 through the original mobile navigation, and preserve the same browser page throughout.
8. At each viewport assert the original `isPhoneViewport_()` result, app viewport-height metric, authenticated shell, POS V2 page and absence of Bank navigation and restricted Products-add action.
9. On phone layouts activate the original Cart/Customer/Payment tabs and verify selected-state semantics without adding products.
10. Capture a screenshot for every stage and confirm the product search remains within phone width.
11. Prove no sale-creation/posting RPC was invoked, the Clerk login occurred exactly once and direct forbidden Bank navigation still falls back safely.
12. Do not infer live checkout, real user authorization, hardware rendering or financial correctness from this synthetic browser regression.

## Superpowers TDD and exit

- **RED commit:** add the browser acceptance test before its M01-only viewport stage fixture exists; expect a scoped `ERR_MODULE_NOT_FOUND` in the actual Chromium CI job, not a production bug. Verify the observed GitHub job/log before calling RED complete.
- **GREEN commit:** add only `qa/m01-viewport-cycle-fixture.mjs` defining the four synthetic viewport steps. No source/runtime change.
- **Required checks:** original-browser/Playwright, source integrity, Foundation, real local Workerd/D1 and every exact-head required workflow. Never merge a pending/failed check.
- **Evidence:** test name, 4 viewport screenshots, no unauthorized nav/financial posting and exact SHA links.
- **Rollback:** revert M01 test+fixture+plan files; no real data or accounting changes.
