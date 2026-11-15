# Superpowers TDD plan — M01 print dialog guard and cleanup

- **Read first:** `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, `legacy/source/javascript.html::printInvoice_`, current `qa/serve-compiled-ui.mjs`, existing M01 Chromium suite and NPM script.
- **Acceptance-first:** Add independent `qa/m01-print-flow.spec.mjs` with short, synthetic Chromium tests. Exercise the actual source `printInvoice_` for A4 and thermal modes, no-payload guards and exception cleanup. Stub `window.print` only as a synchronous dialog boundary and capture DOM before the original source `finally` executes. New tests are written before changing the runner invocation.
- **Minimal wiring:** Update only `package.json` `test:m01:browser` to run the existing M01 suite plus new suite. No framework/source change, no new dependencies.
- **RED → GREEN discipline:** Run the test-first branch in GitHub CI. If a genuine behavior failure is found, keep its evidence and propose a separately scoped source-compatibility fix; do not modify frozen UI or manufacture RED. Passing new tests on their first run is a legitimate test-only coverage outcome, not an implementation fix.
- **Validation:** Require M01 browser CI, Foundation Node + 84-source verification + 36 include build, and other exact-head local-only Workerd/D1/Cloudflare PR safety checks. Report individual statuses, links and screenshots if any.
- **Review:** Open a single draft PR, no auto-merge, list affected files/RPC/tables/bindings. Revert the PR if necessary.

**File inventory:** new `qa/m01-print-flow.spec.mjs`, changed `package.json` (test script only), two docs. **RPC:** none added or changed. **Data/SQL/auth/deploy:** no changes. **Original UI or Mohim ERP:** no changes. **PR boundary:** no edits to `qa/m01-browser.spec.mjs` to avoid conflict with open PR #208.
