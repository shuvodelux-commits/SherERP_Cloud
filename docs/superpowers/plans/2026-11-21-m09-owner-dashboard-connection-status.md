# M09 Owner Dashboard — truthful Shop D1 connection status (21 November 2026)

> **Superpowers method:** source inspection → failing test (RED) → minimum compiled-only UI fix (GREEN) → original Owner browser proof → screenshot review → exact-head GitHub CI.

**Problem:** In the deployed SherERP Owner app, the original `dashboard.html::dashLoad()` invokes `serverCall('getDashboardStats')`. The private Owner bridge does not implement that complete, eleven-field financial source contract, so it rejects with the generic message “Shop business data is not connected yet.” This message is **not a D1 connectivity test**. A verified signed-in Owner already has immutable Control/Shop D1 identity; this generic message is misleading.

**Current read-only Cloudflare proof:** Worker `shererp` active version 70 has `CONTROL_DB` and `PLATFORM_PILOT_DB` D1 bindings. `scripts/m03-live-owner-readiness.mjs` against the existing `shererp-shop-001` reported `authConfigured=true`, `shopIdentityVerified=true`, `baseline13Verified=true`, `approvedSupplierOverlayVerified=true`, `coreReadConfigured=true`; two feature flags and several M10/M11 release gates remain blocked. **Do not create another Shop D1 or automatically enable posting.** The public `wrangler.jsonc` foundation is not this privately bound Owner release.

## Implementation scope (12 sentences)

1. The existing Shop D1 binding is already live, so this change will not create another database.
2. The original Dashboard source function and eleven-field semantics must remain intact.
3. There is no complete authenticated Shop D1 read for the original Dashboard's eleven accounting totals yet.
4. Returning fabricated zeros, cross-role net balances or partial aggregates as full totals is prohibited.
5. The common original Owner `serverCall` fallback must remain fail-closed for unsupported RPC methods.
6. The compiled HisabIQ Dashboard can recognize **only** the known unsupported summary failure in the **Owner** app.
7. That case will show a compact inline bilingual status, not a recurring global database-disconnected toast.
8. The notice will clarify that individual module reads are independently connected or unavailable and that complete dashboard totals need further integration.
9. Other errors, including expired session or wrong server response, must still surface through the existing error handler.
10. A later complete `getDashboardStats` success must clear the inline status instead of leaving a stale warning.
11. Existing numeric placeholders, account roles, Product/Purchase/POS/Return writes, legacy handlers and print must remain unchanged.
12. Playwright will validate 390px and 1440px before/after and the browser test will keep the other Owner routes fail-closed.

## Hard boundaries

- Change only `scripts/patch-hisabiq-dashboard.mjs`, `src/ui/hisabiq-dashboard.html`, new M09 tests and this plan/review evidence.
- **Do not edit** shared `scripts/build-owner-frontend.mjs` (parallel M01 POS/Product PRs), Worker `src/m03-owner-redemption-worker.js` (M03 Invoice API PR), Control/Shop D1, schema, migrations, financial RPC kernel, auth, or original GAS source.
- This PR is a **message/UX correction**, not a full Dashboard source-data integration or database deployment. Future complete Dashboard totals require a separate reviewed M03+M09 D1 read contract, eleven-source-group reconciliation and auth/role checks.
- Keep actual inactive and unsupported modules unavailable. Never hide 401/403/503, D1 identity mismatches or other unexpected errors.
- Follow the pinned HisabIQ UI tokens and breakpoints (320, 390, 768, 1024, 1440). Exact `/ui-refine-skill` may not be installed in this environment: document limitation, run Playwright screenshots and inspect manually.

## TDD tasks

- [x] RED contract: compiled Owner Dashboard must contain a hidden inline state with explicit incomplete totals and no money fabrication, and compile-only loader must suppress **only** the known unsupported Dashboard RPC generic toast for an authenticated Owner.
- [x] GREEN: adapt compiled-only `dashLoad` error branch; public/original source remains untouched and other errors continue to global toast.
- [x] Browser: reproduce the unsupported Dashboard call on synthetic authenticated Owner session, verify note, no global misleading toast, unknown/private write fails closed; phone 390 and desktop 1440 screenshots.
- [x] Full: original Dashboard compilation/source tests, Owner browser regression, source verifier, docs check, no HTML print regression.
- [x] Commit, push, open PR; link live read-only D1 diagnostics to existing #690; **no deploy or SQL writes**.

**Rollback:** revert this small compile-only Dashboard PR; no database recovery action required. CI and human review required before merge.

## Completed evidence

- Live read-only Wrangler: D1 list, deployed Worker bindings and strict first-Shop identity/schema readiness; **no remote writes**. Reuse existing Control and first Shop D1.
- RED 2/3 initial Dashboard contract assertions, RED 1/3 post-screenshot inaccurate global banner; GREEN 12/12 Dashboard compile contracts and 100/100 broader M09 Dashboard source models after isolated clean `npm ci`.
- Chromium **32/32** affected Owner, Party and Dashboard browser cases across 320/390/768/1024/1440px, including session denial and unrelated-error propagation.
- Authentic before capture from unchanged baseline main plus post-fix after capture at 390 and 1440px inspected manually; review `docs/reviews/m09-owner-dashboard-readiness/README.md`.
- Source manifest 84/84 and documentation links passed; a proposed standalone GitHub Chromium workflow was **not included** because existing OAuth token lacks `workflow` scope; 32/32 Chromium suite was executed locally and existing PR CI remains required.
- Full Dashboard original 11-field D1 read, hosted authentication/browser activation, M10/M11 release gates remain outstanding; the PR does not claim them.
