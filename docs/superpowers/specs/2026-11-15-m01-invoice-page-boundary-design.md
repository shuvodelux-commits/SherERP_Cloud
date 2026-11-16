# M01 invoice page boundary and escaped-text browser acceptance

## Scope and source

Previous merged M01 PRs #208/#212/#247/#251 exercised physical A4 1/25/49 rows, 58/80 mm thermal, original JPG and mobile landscape. Exact-multiple A4 page boundaries (24, 48, 72 rows) and safety of shop/customer/product text escaping in the original invoice renderers are not yet browser-covered.

Source: pinned Mohim_ERP at 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2. Execute the original unchanged legacy/source/javascript.html function renderInvoicePrintHtml_ with its real style.html in Chromium. No production API, login, D1 or financial posting is involved.

## Acceptance

1. Synthetic A4 invoices with 0, 24, 48 and 72 items produce 1, 1, 2 and 3 original renderer chunks respectively and exactly those physical Chromium PDF pages, without a trailing blank sheet.
2. Each chunk repeats shop and table headings, all items appear once, and customer info appears only on the first page. Totals, footer and paid badge appear only on the final page. Numbering continues without restart.
3. HTML-shaped strings in product name, customer name, shop name and invoice ID must be shown as literal text by the original A4 and thermal renderers. No injected element is created (e.g. a fake SVG or button).
4. Synthetic evidence PDFs are retained in the existing m01-browser artifact for GitHub review.

## Boundaries and caveats

New independent qa/m01-invoice-edge.spec.mjs, package.json browser test script update and two plan/design documents only; no changes to frozen source, application UI, Worker/RPC, database/schema, Party/finance, Cloudflare bindings/deploys or external dependencies. These are synthetic browser tests, not production printer, authenticated POS or real customer transactions.

Test-first evidence is required. A pass on first run is honest regression coverage, not a fabricated bug fix. If a real failure occurs, document RED before any correction and do not silently modify byte-preserved original source.
