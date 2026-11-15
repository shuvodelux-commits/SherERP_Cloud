# M01 — Original invoice renderer Chromium A4 pagination regression

## Problem

Existing M01 Chromium print test hand-writes a one-line table in `#printHost`. It verifies print CSS, but never executes the original pinned `javascript.html::renderInvoicePrintHtml_` with true multi-page invoice payloads. It therefore cannot detect missing repeat headers, duplicated bottom totals, lost row numbering, or a blank overflow page.

## Scope and source

- Source: original frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/javascript.html` and `style.html` (read-only).
- Reuse existing `qa/serve-compiled-ui.mjs` and its real inert Worker fail-closed API. Browser is unauthenticated; all invoice data is constructed synthetic inside Chromium.
- Render **using the real legacy `renderInvoicePrintHtml_`**, not reimplementing an invoice generator in tests.
- Check source row budget 24, explicit 1/25/49-item boundary scenarios, per-page header/table, continuous Bangla row indices, first-page-only customer, final-page-only totals/footer/paid badge, and physical A4 PDF page count with no blank trailing sheet.
- Keep original static source, actual app backend, D1, business contracts, production Worker, build config, auth and Cloudflare workflows unchanged.

## Testing method

Introduce browser assertions first in the existing M01 Chromium suite. Observe their result from exact GitHub Actions head before any implementation. If actual source behavior fails, preserve the source and report the defect rather than quietly rewrite the original app. A test-only acceptance increment needs no production implementation; if test harness behavior is genuinely missing, use a minimal fixture-only correction with recorded RED → GREEN. No fabricated failures.

## Limitations

Tests use fixed synthetic data and headless Chromium; they cannot establish successful login, full source invoice financial parity, live transactional reprint, printer-driver page margins, thermal widths or deployed Worker/D1 readiness. No staged/production migration.
