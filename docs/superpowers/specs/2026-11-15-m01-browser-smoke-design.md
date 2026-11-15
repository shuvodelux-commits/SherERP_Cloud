# M01 real-browser smoke QA — design (2026-11-15)

## Intent
Close the missing automated browser-execution gap for SherERP's original preserved HTML/CSS/vanilla JavaScript shell, while financial/auth APIs are not yet migrated. Existing `docs/M03_PARALLEL_READINESS.md` explicitly permits independent M01 browser/print/mobile QA, with no backend work or redesign.

## Source and architectural constraints
- Source of truth: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and its frozen `legacy/source` copies.
- Preserve all original HTML, CSS, JS, DOM IDs, navigation, invoices and `serverCall(fnName,...args)`.
- Do not change `src/db`, `src/rpc`, migrations, Cloudflare preview/staging deploy configs, D1 bindings, user data, balances, Party semantics, or real authentication.
- `main` remains a nontransactional Worker shell. CI is PR-only, secrets-free, no deploy.

## Approaches considered
1. Static regex/compiled-HTML assertions: already covered in a separate M01 PR, but do not execute JavaScript, responsive layout or print media.
2. Start a full authenticated ERP and E2E POS workflow: unsafe and impossible before M03/M04 and ledger kernel gates.
3. **Selected:** real Playwright Chromium against the compiled, patched original HTML with a loopback-only HTTP fixture that **always rejects** `/api/rpc` with 501. Test observable login, viewport and print behavior without fake successful endpoints.

## Test architecture
- `qa/serve-compiled-ui.mjs` builds the frozen source using existing `buildFrontend`, patches only transport using existing `patchServerCall`, and serves the output on an ephemeral `127.0.0.1` port. The server has no D1, secrets, user fixture records or writes and always fails closed for RPC. It cleans its temporary directory and closes the port.
- `qa/m01-browser.spec.mjs` runs four real Chromium checks: desktop login visible but protected app hidden and no runtime page errors; 375px touch/mobile login card fits viewport; synthetic invalid login produces controlled 501 and never authenticates; Chromium print CSS displays the isolated invoice host, repeats table headers, prevents row splits, generates valid A4 PDF.
- Save only **synthetic** desktop/mobile PNGs and PDF to ignored `test-results/m01-browser/`. These are CI review evidence, not golden pixel assertions.
- `npm run test:m01:browser` is an explicit opt-in suite, separate from dependency-free `npm test`.
- A new `.github/workflows/m01-browser-qa.yml` executes on pull requests with Node 22, pinned Playwright 1.65.1, Chromium download, screenshot/PDF artifact upload; no secrets or deployment.

## Limitations
The browser fixture rejects real RPC calls; it proves only the **unauthenticated** shell behavior, not real login credentials, successful navigation, POS transaction flows, actual invoice content/pagination or D1 security/accounting correctness. PDFs use synthetic DOM markup and must not be mistaken for real invoice parity. Further Playwright authenticated flows must wait for reviewed M04 and source-compatible posting contracts. PR #26 may remain independently open, and this branch must not duplicate its static inspector.