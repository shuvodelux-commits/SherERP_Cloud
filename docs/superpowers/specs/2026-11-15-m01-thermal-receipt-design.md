# M01 — original 58mm / 80mm thermal receipt browser regression

## Intent

Prior merged M01 regression #185 validates original multi-page A4 invoices and #201 validates inert login/session failures. The original `renderInvoiceHtmlThermal_` and named @page 58mm/80mm print styles have not been executed in real Chromium regression. This misses a major shop-counter output path.

## Architecture

- Source pin: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and byte-identical `legacy/source/javascript.html`, `style.html`.
- Only existing compiled UI, `qa/serve-compiled-ui.mjs`, and Playwright Chromium. Actual original receipt renderer and original CSS; synthetic payload only; no fake successful RPCs, authentication, D1/financial data or deployed Worker.
- Print-only host is a direct child of body. `invoice-paper thermal size-58` selects a 58mm named print page; `invoice-paper thermal` selects 80mm.
- Regression includes two receipt sizes with real Chromium PDF page width assertions (PDF points = mm * 72 / 25.4), one physical short-receipt page, product lines, sale payment breakdown and absence of A4-only sections.
- A separate synthetic draft exercises the original DRAFT mark and preserves the original paid/balance data rendering without running any actual sale.

## Acceptance and limitations

1. Original renderer produces a single `thermal-page` and the supplied synthetic items; no A4 `inv-table`, invoice signatures, payment chips or long terms in the thermal structure.
2. Both 58 and 80 mm Chromium PDFs have appropriate MediaBox widths (tolerance 1.5 pt) and exactly one page for a short receipt, without a blank A4 sheet.
3. Original renderer shows checkout applied payment and cash change as separate values, not a new revenue item.
4. Thermal draft marker appears only for draft and does not invoke transactional accounting.
5. Browser test failures are real evidence (do not fake TDD RED); a bug in frozen source must be reported for owner review instead of silently changing original source. Tests that pass at first attempt are test-only coverage, not code fixes.

No claims about physical thermal printer drivers, tall 200mm roll pagination, live sale totals, successful authenticated POS, real financial posting or production D1. No external package changes.
