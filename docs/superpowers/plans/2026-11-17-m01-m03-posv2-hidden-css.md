# M03/M01 single-owner frontend integration — POS V2 restricted Add Product visibility (issue #482)

**Approval:** Owner's 2026-11-17 instruction to fix, then merge after full CI.
**Coordination:** `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, central issue #456, M03 issue #22, M01 issue #25, defect #482.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; do not edit `legacy/source/**`.
**Main base:** `bcd2d3adbd03f35612c50c1a144a472b1683b412`.
**Shared integration owner:** M03/M01 frontend build coordination; reserve this branch for this exact one-line compiled CSS visibility defect and no other source change.
**Proposed paths:** new `scripts/patch-posv2-visibility.mjs`, `package.json` frontend-build script and browser-script entry, `qa/serve-compiled-ui.mjs` test-only compiled UI fixture, new `qa/m01-posv2-compiled-visibility.spec.mjs`, and this plan. No other module should edit these paths until merge.
**Dependencies:** original shell, M01 merged #457 and #472; downstream M01 draft #476 will stay unmerged and retain its RED tests until this reviewed PR reaches main.
**Read/write scope:** Generated `dist/index.html` compiled CSS only (and temporary local browser HTML); no runtime/server/DB/RPC/posting change.
**Rollback:** revert this integration PR; no database migration or data rollback.

## Minimal approved implementation (12-sentence overview)

1. The original POS V2 controller correctly sets `v2AddProductBtn.hidden` for a staff role without `products.add`.
2. Real Playwright Chromium at 320×640, 768×1024 and 1280×800 demonstrated `hidden=true` but `computedDisplay='flex'` because the shared author CSS gives `.btn` a display value.
3. The owner explicitly requires the existing Playwright regression to remain failing until compiled UI presentation is corrected.
4. Preserve the source and all original DOM events by fixing only the generated CSS after HTML assembly.
5. Create a tiny pure CSS-patch function that requires one exact POS V2 selector boundary and refuses ambiguous/missing source.
6. Insert `#v2AddProductBtn[hidden] { display:none!important; }` into the compiled POS V2 style using the original prefixed selector, with an idempotence guard.
7. Keep `[hidden]` absent for an explicitly authorized `products.add` user, so the button remains visible.
8. Wire the same pure patch into both production `npm run build:frontend` and local loopback Chromium fixture after source assembly; don't patch the frozen HTML files.
9. Add test-first Node assertions for insert-once, refusal on changed/multiple selectors, and never altering non-POS controls.
10. Add actual Playwright Chromium tests at phone, tablet and desktop widths with synthetic login and synthetic app-shell metadata, checking both unauthorized invisibility and authorized visibility.
11. Confirm protected Worker RPC remains inert; neither test nor patch submits sales or edits Party/stock/account balances.
12. Run all full GitHub CI, including mandatory M01 Playwright, source-identity, Cloudflare safety and local Workerd/D1 shards, before merge.
13. When this integration PR is safely merged, refresh blocked M01 PR #476 on the new main and require its complete exact-head browser/CI gates again.

## Forbidden changes

No edits to `legacy/source/**`, `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `src/auth/**`, Workerd bindings, financial posting, session semantics, real D1 data or existing business event handlers. The build patch changes only the restricted display outcome in generated UI and is intentionally not backend authorization. Release/production activation remains blocked by M03 readiness; the public Worker is still fail-closed.
