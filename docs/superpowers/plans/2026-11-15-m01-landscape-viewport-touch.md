# Superpowers M01 implementation plan — landscape orientation

**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Workstream:** M01 browser/viewport parity.

1. Read `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`, ADR-007 (no Party change), original `login.html`, `style.html` responsive rules, `javascript.html::isPhoneViewport_/wireMobileViewportMetrics_`, and current browser fixture.
2. Add acceptance-first Playwright `qa/m01-landscape.spec.mjs`. Run original frontend in real Chromium with mobile touch contexts and desktop fine-pointer comparison, assert orientation/viewport CSS state and touch login behavior. Use synthetic credentials and only the inert Worker failure.
3. Minimal runner wiring: update only `package.json` `test:m01:browser` script after the test-first commit. No dependency or source modification. Preserve landscape screenshot under existing browser evidence directory.
4. Run exact-head PR GitHub Actions M01 Chromium + Foundation source audit/hash/build, local Workerd/D1, Cloudflare PR safety. If RED, inspect actual run logs and report original-source failure before proposing a compatibility fix. Never fabricate RED or claim production changes where none exist.
5. Keep branch/PR scoped and draft until final CI and owner review. No direct main commit.

**File/RPC/table inventory:** new QA file, `package.json` script-only, two docs; no new RPC or modified payload; no SQL/migrations, D1, auth, POS, finance, Cloudflare runtime, or source repo. **Rollback:** revert branch PR.
