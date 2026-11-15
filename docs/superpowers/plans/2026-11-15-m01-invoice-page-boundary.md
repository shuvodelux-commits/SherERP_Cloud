# Superpowers execution plan — M01 original print edge cases

1. Read AGENTS.md, docs/MIGRATION_PLAN.md, docs/WORKSTREAMS.md, ADR-007 and original renderInvoicePrintHtml_, A4 CSS, renderInvoiceHtmlThermal_, current M01 browser suite and fixture; record pinned Mohim_ERP SHA 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
2. Acceptance-first: add qa/m01-invoice-edge.spec.mjs, with real Chromium PDF page count at 0/24/48/72 source items and source-renderer escape/DOM injection checks. Retain generated PDFs for code review.
3. Minimal test-runner wiring: add only the independent test file to package.json test:m01:browser after committing acceptance tests. Never edit the frozen legacy/source, UI, Worker RPC or financial flows for a QA-only PR.
4. Validate exact-head M01 browser, Foundation tests/build/source verification, local-only D1 integration and Cloudflare PR safety. Report observed RED precisely or first-run GREEN truthfully. Avoid unsupported assertions about live printing or production migrations.
5. Open a scoped draft GitHub PR with file/RPC/table impact inventory and CI artifacts. Merge only after green exact-head checks and owner review.

Affected paths: one new QA spec, package.json scripts and two docs. No migrations/SQL, RPC, D1, auth, Party/finance, Cloudflare configs or original source. Rollback: revert PR.
