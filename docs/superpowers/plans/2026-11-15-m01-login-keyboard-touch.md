# M01 keyboard and narrow mobile login — Superpowers plan

**Workstream:** M01 preserved frontend regression, after merged #185. **Original source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. **Source review:** Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, original `login.html` / `javascript.html::wireLoginForm_` and login CSS. Verify the current `qa/m01-browser.spec.mjs` and `qa/serve-compiled-ui.mjs`.
2. **RED / acceptance-first:** Add Chromium tests before any implementation. Verify negative validation, Enter-key path, password visibility, 320px touch reachability and public Worker failure contract. Run the exact test-only HEAD through GitHub Actions and capture real failures, if any; do not artificially break functioning source.
3. **GREEN / minimal change if required:** Because the original frozen frontend is source-of-truth, any discovered original-source failure remains a separately scoped review finding; do not mutate `legacy/source/**`, change the Worker or invent auth success merely to turn the test green. Test-only coverage that passes first try is acceptable and must be described as such.
4. **Verify:** Check `npm test`, `npm run verify:source`, frontend build and actual Chromium/Playwright output in Actions. Confirm that no backend, Cloudflare bindings or D1 work took place and report exact-head statuses honestly.
5. **Review:** Create a single draft PR, include file/RPC/table inventory, screenshot evidence and rollback-by-revert. Keep unmerged pending owner review of real CI and outstanding limitations.

**Changed files:** one existing browser QA script plus two new docs. **RPC impact:** test-only original login method, no API mutation. **SQL/schema/DB:** none. **Deployment:** none. **Dependencies:** none. **Rollback:** revert PR.
