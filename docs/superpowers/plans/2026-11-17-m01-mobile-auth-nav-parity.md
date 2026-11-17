# M01 / #25 — Original authenticated mobile and tablet navigation QA

**Main base SHA:** `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`  
**Source SHA:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (read only).  
**Dependencies:** M00 preserved source; merged M01 #396, #411, #419, #433; synthetic local browser only. M04 public authenticated UI remains gated by M03.  
**Primary ownership:** M01 QA, per `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, coordination #456 and module issue #25.  
**Files:** `qa/m01-landscape.spec.mjs`, new `qa/m01-auth-nav-fixture.mjs`, this M01 plan.  
**RPC read/write impact:** Test-only interception of `login` and `getAppShellData` in isolated Chromium; no public routes, no D1 tables, no financial transactions, no real credential storage outside disposable browser context.  
**Shared owner / conflicts:** M03 owns `src/db`, migrations, `src/rpc`, `src/index.js`, shared SQL/ID/cash-session interfaces. Do not edit those, `package.json`, shared CI workflows or `legacy/source`.

## 12-sentence execution overview

1. Preserve the complete pinned original HTML/CSS/JS UI without reimplementation.
2. Extend the existing M01 Chromium landscape suite because `npm run test:m01:browser` already includes it.
3. Reproduce a source-shaped Clerk login using synthetic local browser interception, not a production account.
4. The synthetic authorization allows Dashboard and Reports, while Bank is intentionally excluded.
5. Test that phone primary-navigation buttons for unauthorized modules are actually hidden.
6. Open the original More menu with a touch gesture and require Reports to be listed while Bank is absent.
7. Navigate by tapping Reports and verify the original active page and More sheet close.
8. Recheck a rotated coarse-pointer landscape viewport without rebuilding the app or issuing extra login RPCs.
9. Load a separate 768px portrait tablet and check role-filtered sidebar, preserved login success and viewport layout.
10. Capture stable phone, landscape and tablet screenshot artifacts under `test-results/m01-browser`.
11. Commit the missing-helper acceptance test first, record the exact RED GitHub browser job, then add only the M01 fixture for GREEN.
12. Run exact-head full GitHub CI, inspect the three-file diff and leave an owner-reviewed PR unmerged until all required checks pass.

## Acceptance and limitation

The fixture must not use M03 private Workerd adapters, public auth, remote D1, real financial data or original backend calls. This tests *presentation behavior only*; the server must separately authorize every financial RPC. No claim of live end-to-end POS parity, source-data readiness or customer-data migration. M01 only consumes the reviewed response shape from merged M04 contracts. The successful synthetic Clerk token is test-only and discarded on page/context closure. The test must never store a real token in an artifact or commit screenshot files. The RED event is missing QA fixture capability, not a simulated production authentication vulnerability. Changes to source/global RPC, if subsequently indicated by a failing parity assertion, require M03/M01 integration coordination rather than unauthorized edits.
