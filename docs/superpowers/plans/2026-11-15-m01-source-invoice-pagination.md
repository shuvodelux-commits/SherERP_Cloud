# M01 — Superpowers execution plan: original multi-page A4 invoice

**Objective:** Extend established M01 Chromium regression to exercise preserved legacy invoice print renderer and verify actual physical A4 pagination.

**Pinned original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Architecture: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/WORKSTREAMS.md`. Design: `docs/superpowers/specs/2026-11-15-m01-source-invoice-pagination-design.md`.

## Tasks

1. **Inspect:** Read `legacy/source/javascript.html` renderInvoicePrintHtml_/INVOICE_ROWS_PER_PAGE, `legacy/source/style.html` printing-invoice CSS, existing Chromium smoke suite and fixture. Confirm source 24-row budget and 1/25/49-page chunking.
2. **Test-first:** Add synthetic original-renderer browser test for 1, 25 and 49 items before any implementation. Exercise DOM structure and A4 PDFs, not a fake HTML table. Run exact-head GitHub M01 browser workflow; capture pass/fail and meaningful regression evidence. Do not force artificial RED. If actual output is wrong, diagnose and report before modifying original source.
3. **Minimal fix if needed:** Only adjust QA support in a follow-up commit if the harness cannot invoke existing original renderer or render PDF. Never mutate legacy original source, backend, posting or schema. Re-run failing case to GREEN.
4. **Verify:** Require `npm test`, pinned source hash verification, compiled frontend, real Chromium browser tests and no-secrets PR workflows on exact head; distinguish isolated synthetic browser tests from live invoice printing.
5. **Review:** Draft scoped PR with source/RPC/DB impact and exact-head CI evidence. Remain unmerged for owner review.

## Impact and rollback

Only existing `qa/m01-browser.spec.mjs` and these docs. No additional npm packages, SQL, RPC, D1, auth, print source, Cloudflare configuration, migrations, production data or original Mohim_ERP modifications. Rollback: revert this test-only PR. M03/M04/M06/M10 production gates remain independent.
