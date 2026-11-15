# M03/M04 authorized source app shell — Superpowers TDD execution

**Spec:** `docs/superpowers/specs/2026-11-15-m03-m04-authorized-app-shell-design.md`.
**Base:** latest reviewed `main` of SherERP_Cloud. Isolated branch `feat/m03-m04-authorized-app-shell-20261115`.

1. Inspect AGENTS.md, M03/M04 plans, pinned `legacy/source/UI.gs`, `src/modules/source-app-shell-reader.js`, `src/db/m04-settings-view.js`, original browser pre-login call and existing local D1 fixture. Do not expose public RPC.
2. **RED:** commit test-first `tests/m03-m04-authorized-app-shell.test.mjs` requiring a currently missing `src/modules/m04-authorized-app-shell-reader.js`. Extend the existing `m03-m04-settings-view-workerd.spec.mjs` with a new missing-import expectation and real D1 active/denied/freshness assertions. Run exact-head GitHub CI and record expected `ERR_MODULE_NOT_FOUND`.
3. **GREEN:** refactor source reader minimally to export `buildSourceAppShellData(settings)`, keeping existing source-pinned `NAV_ITEMS` exactly unchanged. Add internal `createM04AuthorizedAppShellReader(env)` calling the existing M04 authorized two-key D1 read exactly once and composing the response. Never perform a separate unprotected DB read.
4. Verify focused Node, full `npm test`, real `tests/integration/m03-workerd.spec.mjs`, 84-file source pin, 36-include build, Cloudflare PR Preview safety and M01 Chromium as GitHub Actions executes. Check full exact-head workflow and report failures honestly.
5. Open/refresh the PR with source/RPC/table inventory, RED/GREEN evidence, known deployment gates and rollback; do not merge or activate production.

**Review focus:** one-query authorization, display tree versus permissions, deep-clone isolation, no accidental public RPC exposure, stale session failure, original fallback parity and unchanged original nav literal. No SQL/schema change.
