# M01 — original print dialog lifecycle and cleanup regression

## Scope and source

The original SherERP `printInvoice_` copies the current invoice into a direct-child `#printHost` and temporarily marks `body.printing-invoice`. Previously tested M01 PR #185 verifies A4 rendering and open PR #208 verifies actual 58mm/80mm thermal PDF sizing. Neither covers the actual print action's guard and cleanup lifecycle.

Pinned source: `shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/javascript.html` and `style.html` are byte-identical preserved inputs. Source must not be modified by this test-only PR.

## Acceptance

1. A4 print with synthetic invoice invokes the original `printInvoice_(false, fixture)`, and at the synchronous `window.print` boundary `body.printing-invoice` and a correctly populated `#printHost` are present. After the dialog returns, both temporary state and printed markup are gone.
2. Thermal print with synthetic invoice respects 58mm and 80mm CSS classes, invokes its original renderer and also cleans up. Real PDF width checks are tracked separately in #208.
3. Empty A4 markup and thermal-without-payload must *not* call `window.print`, create transient print HTML or reveal the protected shell.
4. Even if `window.print` synchronously throws (synthetic browser failure), the original `finally` cleanup clears the temporary print state. The test catches the exception without changing the production handler.
5. Each case uses the actual Chromium DOM with a **stubbed browser dialog only**. The test does not simulate a successful login, an actual sale, a thermal printer, or a Cloudflare/D1 transaction.

## Isolation and concurrency

Add a separate `qa/m01-print-flow.spec.mjs` (not the M01 suite file currently edited by #208). Wire it to existing `npm run test:m01:browser` by updating `package.json`, without updating its lockfile (scripts only). New design and plan docs are source-controlled; no new runtime dependencies. The existing local browser fixture still delegates all API calls to the inert public Worker, unauthenticated and DB-free.

## Evidence

Test-first GitHub Actions from exact PR head. Document actual RED if reproduced; if tests pass immediately, call this additive baseline coverage, not a bug fix. Avoid touching frozen UI, Worker auth, RPC, schemas, finance, deployments or source repository. No M01 acceptance claim for authenticated business flows. Roll back with a scoped PR revert.
