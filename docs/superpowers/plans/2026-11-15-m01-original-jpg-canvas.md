# Superpowers plan — M01 source JPG canvas/browser download

**Workstream:** M01 frontend parity. **Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

1. Review `AGENTS.md`, M01 scope in `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 (no schema impact), original `downloadInvoiceJpg_`, `buildReceiptCanvas_`, `drawReceiptCanvas_` and browser fixture.
2. **Acceptance-first:** Write separate `qa/m01-jpg.spec.mjs` using Playwright and `serveCompiledUi()`. Test actual canvas generation, dimensions, native JPEG encoding/decoding, paid/draft drawn text, corrupt-logo fallback and native download filename and bytes. No fake authenticated RPC or invoice success.
3. **Minimal runner hookup:** Change only `package.json` `test:m01:browser` to run the new browser file alongside existing M01 scripts. No lockfile change, code refactor or dependencies.
4. **RED/GREEN honesty:** Run exactly this test-first head in GitHub Actions. If new assertions fail, identify a genuine defect before fixing or adjusting. Do not manufacture a failing regression. Passing test-only code on first run is coverage, not a production fix.
5. **Verification:** Require exact-head M01 real Chromium, Foundation Node/source/build, PR Cloudflare safety and relevant local Workerd/D1 integration checks. Record final statuses and risks in PR, do not merge before owner review.

**Affected files:** one new QA script, `package.json` script-only, two new design/plan docs. **RPC/tables/migrations/Cloudflare bindings:** none. **Rollback:** revert scoped PR. **Original HTML/CSS/JS:** byte unchanged. **Production authentication, POS posting, and actual customer's download:** not exercised.
