# Superpowers test-first plan — M01 long thermal receipt print

1. Read repository `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, ADR-007 (no financial/account identity changes), original thermal functions/styles, and current M01 Chromium fixture. Pin `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
2. **Tests first:** create a standalone `qa/m01-thermal-long.spec.mjs` on a dedicated branch with 32 synthetic items per 58mm/80mm roll. Exercise original `renderInvoiceHtmlThermal_` and Chromium PDF: assert ordered rendered items, wrapping, actual per-page paper dimensions, multi-page output, receipt totals and original cash-change semantics.
3. **Minimal integration:** after committing the new test file, append it to the existing `npm run test:m01:browser` command in `package.json`. No source implementation, new packages, or unrelated edits. Store two synthetic thermal PDFs in existing `test-results/m01-browser` artifact directory.
4. **RED/GREEN honesty:** inspect exact-head GitHub Actions. If the new acceptance fails, record observed RED and investigate root cause; do not manufacture RED or silently rewrite source. A clean first pass means new baseline coverage, not a production bug fix.
5. Require Foundation source hash and Node tests, M01 real Chromium, M03 local Workerd/D1, and all other exact-head PR checks. Open a scoped draft PR, record evidence and known limitations; wait for owner review/green CI before merge.

No live RPC, transactions, D1 migrations, Cross-Party settlement, or Cloudflare public bindings. Original UI remains byte-for-byte unchanged. Rollback: revert the scoped PR.
