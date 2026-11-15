# M01: original JPG invoice canvas — Chromium acceptance design

## Motivation and pinned source

Merged M01 PRs #185, #208, #212 cover original A4 pagination, 58/80 mm print media and print dialog cleanup. The original `downloadInvoiceJpg_` and `buildReceiptCanvas_` code is a distinct canvas drawing/export path that has no real-browser acceptance check. Validate the frozen implementation before any migration change.

Original source of truth: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. This test uses exactly the preserved `legacy/source/javascript.html`, compiled through existing `qa/serve-compiled-ui.mjs`. The source and the inert public Worker remain unchanged.

## Acceptance

1. Using a synthetic one-line invoice, `buildReceiptCanvas_` returns an actual Chromium HTMLCanvasElement with the original fixed 840px (420 CSS px ×2) width and positive height; `toBlob('image/jpeg', 0.95)` produces a nonempty image/jpeg Blob whose image decoder reports the same dimensions. No SVG/foreignObject or third-party rendering service is introduced.
2. Source paid versus draft invoice versions produce distinct content: draft draws the `DRAFT / খসড়া` marking but not the final PAID label; the non-draft zero-due sale draws PAID but not the draft marking. Observe actual `CanvasRenderingContext2D.fillText` calls without replacing rendering algorithms.
3. The public `downloadInvoiceJpg_` uses the actual native Chromium download event, with a synthetic invoice ID filename and decodable JPEG bytes. The download is generated client-side and does not call `/api/rpc` or reveal `#app`.
4. An unusable synthetic logo URI must not stop the original canvas renderer: `loadInvoiceLogoImage_` falls back to no logo and still yields a valid JPEG.

## Safe boundaries and evidence

New independent `qa/m01-jpg.spec.mjs`, a `package.json` *test script only* change, and two design/plan Markdown docs. No edits to `qa/m01-browser.spec.mjs`, `qa/m01-print-flow.spec.mjs`, frozen source, Worker, D1/schema, authentication, Party accounting, production deployment, frontend design, or external dependencies. No real user/transaction data. Preserve the preexisting public Worker fail-closed behavior.

Tests are acceptance-first. If source already passes, report regression coverage with no fabricated RED / behavior fix. If observed failures occur, capture them before a separately scoped review, rather than altering frozen HTML/CSS/JS. Real download is checked in Chromium; actual OS file association and printer compatibility remain outside scope.
