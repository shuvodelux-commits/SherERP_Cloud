# M01 — Original browser Day Book RPC to isolated Workerd D1 implementation plan

> Use Superpowers executing-plans and test-driven-development. Commit a failing browser acceptance test before adding its local-only fixture hook. Verify RED/GREEN in exact-head GitHub Actions.

**Goal:** Exercise the original compiled frontend's `serverCall('getDayBookBootstrap', token)` against the merged M03 internal-only Day Book bridge and actual local Workerd/D1 Settings/auth records in Chromium, without publicly activating authentication or business RPC.

**Architecture:** Extend only the M01 **QA server** with an opt-in `internalDayBookRpc` callback, which is never used by runtime source or production. The browser serves the frozen original compiled HTML and generated RPC adapter. One new Chromium test uses the existing `createTestHarness` and reviewed `createM03DayBookRpcBridge` with deterministic synthetic staff, role, sessions and Settings data. The QA server exposes only this method to the test browser on loopback; all other RPC calls continue to the actual public inert Worker. Deploy code remains unchanged.

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `AGENTS.md`, `docs/WORKSTREAMS.md` M01, `docs/MIGRATION_PLAN.md` P1, merged M03 Day Book PR #335.

**Tech:** Node 22, Playwright Chromium, Wrangler 4.161.0 `createTestHarness`, existing local-only `wrangler.m09-daybook-authorized-test.jsonc` and D1 fixtures.

## Absolute boundaries
- Do not change `legacy/source` or the old GAS/Sheets; do not modify public `src/index.js`, public `src/rpc/handler.js` or `registry.js`.
- Do not add any D1 binding or production secrets to Cloudflare previews or enable a public login or Day Book RPC endpoint.
- No SQL migrations, financial posting, inventory, cash, bank, Party ledgers, UI redesign, changes to compiled code, or real customer/staff data.
- Test uses only synthetic local D1 and loopback HTTP, and must prove the real public Worker still fails closed for all business calls.
- Authenticated read-model vertical slice is not end-to-end ERP/POS readiness or production authentication approval.

## Task 1 — RED browser acceptance test and CI wiring

**Create:** `qa/m01-daybook-local-d1.spec.mjs`; **modify:** `.github/workflows/m01-browser-qa.yml`.

- [ ] In isolated Workerd, apply approved local auth migrations and synthetic Settings DDL; create one allowed staff role, one denied role, current users and hashed sessions (server-now fixed).
- [ ] Load the frozen compiled original HTML in Chromium via `serveCompiledUi({internalDayBookRpc: ...})` and send `serverCall('getDayBookBootstrap', bearer)`. Expect exact source four-field payload with currency symbol, editable days, modules, `isAdmin` and no private settings.
- [ ] Require denied and then revoked sessions to reject with `Day Book is unavailable or access denied.`, no token storage, login overlay visible and `#app` hidden. Check unrelated RPC still 501.
- [ ] Add a separate local-only CI step installing pinned Wrangler and running the test after the existing Chromium test script.
- [ ] Commit tests/CI first, open draft PR, and inspect RED logs. Expected failure: existing QA server ignores `internalDayBookRpc`, returning public 501 instead of Day Book data.

## Task 2 — GREEN minimal QA server option

**Modify:** `qa/serve-compiled-ui.mjs` only.

- [ ] Add `internalDayBookRpc` optional argument default null to `serveCompiledUi`.
- [ ] On loopback `POST /api/rpc` with exact `getDayBookBootstrap` name, call this **test-provided** internal bridge after JSON decoding; return its envelope with HTTP 200 on success and 403 on denial, with `no-store`/nosniff headers. No other method is handled by the override.
- [ ] All default/no-option traffic still calls the actual public Worker; the test only can activate the hook, which is not imported by deployable runtime.
- [ ] Verify targeted browser/real D1 acceptance, all existing M01 browser/print checks, Foundation Node/source/build suite, exact-head PR CI and full scope diff.
- [ ] Update PR with RED/GREEN evidence, source/RPC/table inventory and remaining M03/M04 gates; do not auto-merge.

## Review focus
- Real browser request `{fnName,args:[bearer]}` and same-origin `POST` is preserved.
- Allowed user gets awaited read-only source-shaped data, not Promise nesting or sensitive Settings.
- Denied/revoked session fails with controlled error and cannot reveal the protected UI.
- Public Worker and unrelated methods remain inert, including if test-only callback is configured.
- All synthetic fixtures and local Workerd are CI-only, not staged or deployed.

## Contracts and impact
- Source / generated frontend / RPC function callsite: unchanged.
- New local-only QA fixture override: added for exactly one reviewed Day Book read; no production HTTP route.
- No migrations/remote data movement, finance postings, source edits or deployment changes. Test harness touches isolated D1 only.
