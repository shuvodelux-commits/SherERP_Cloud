# M01 — long 58mm / 80mm thermal receipt pagination regression

## Source, existing evidence and gap

SherERP_Cloud migration uses frozen original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. M01 PRs #208 and #259 cover one-page short 58/80mm receipts, 24/48/72-item A4 invoices, and markup text escaping, but do not exercise a *long* source-generated thermal receipt across a 200mm print-paper boundary.

The unchanged original renderer is `renderInvoiceHtmlThermal_` in `legacy/source/javascript.html`. CSS names `thermal58` / `thermal80` pages at 58/80mm × 200mm, with 2mm margins and `break-inside: avoid` on items. Test the actual compiled source and Chromium print pipeline with deterministic synthetic data.

## Acceptance

1. Generate a synthetic 32-item receipt for each roll width, with mixed long Bangla/English item names and a partial cash payment. Use the original renderer unchanged, confirming exactly one rendered item per input, matching order and correctly displayed final totals and payment breakdown in the print DOM.
2. Real Chromium PDF with `preferCSSPageSize` must span more than one physical page. All printed physical pages must use the intended 58mm/80mm roll width and 200mm height, never A4-sized pages. The test should retain the two PDFs for visual review.
3. The print DOM must not extend horizontally past the printable roll area, and individual item names must wrap to fit their containers rather than overflowing.
4. The checkout payment breakdown must preserve the actual applied cash and change rather than mistake tendered cash for an extra revenue line. No live financial RPC or posting occurs.

## Limits and safety

A DOM row count is not proof that PDF contains every glyph; PDF width/page checks do not replace visual inspection of saved PDFs and physical printer test. This is browser-level source-parity evidence only, not a production-authenticated POS sale or real printer driver compatibility. A failing test is a genuine signal for owner review; do not alter byte-pinned `legacy/source/**` in a test-only M01 PR.

**Change inventory:** new `qa/m01-thermal-long.spec.mjs`, `package.json` test script only, and design/plan docs. No modifications to frozen HTML/CSS/JS, Worker, RPC, auth, D1, Party/finance, schema, Cloudflare deployment, source repo or dependencies.
