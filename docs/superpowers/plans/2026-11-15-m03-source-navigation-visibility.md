# M03 Source Navigation Visibility — Superpowers execution plan

**Spec:** `docs/superpowers/specs/2026-11-15-m03-source-navigation-visibility-design.md`.
**Workstream:** M03 UI shell (isolated pure read model; not M03-core SQL ownership).
**Branch:** `feat/m03-source-navigation-visibility-20261115`, based on reviewed latest `main` after #134.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Task 1 — Source parity test-first
1. Review `AGENTS.md`, source `legacy/source/javascript.html` navigation helper functions, `UI.gs` NAV_ITEMS, existing M03 shell and M04 role permission contracts.
2. Commit a source-oracle Node test `tests/m03-source-nav-visibility.test.mjs`, evaluating the named original client functions in VM with synthetic permission profiles. Check top-level sidebar selection, visible children, per-sidebar landing and first reachable route; also test deep-copy isolation and explicit safe input validation. **Do not** write the adapter first.
3. **RED:** run GitHub Foundation on test-only head and record expected `ERR_MODULE_NOT_FOUND` for `src/modules/source-nav-visibility.js`.

## Task 2 — Smallest GREEN implementation
1. Add `src/modules/source-nav-visibility.js` exporting `projectSourceNavigation(navItems,profile)`. Do not import/copy the NAV_ITEMS constant; only use passed, source-owned metadata. No client/Worker/RPC edits.
2. Implement legacy sidebar group visibility, subtab selection, source landing preference, first reachable key; require explicit `allowedModules` to prevent undefined accidentally exposing Administrator navigation.
3. Run GitHub Node suite, pinned 84-file source check, original 36-include build, browser Chromium, M03 local Workerd/D1, and Cloudflare PR safety. Report exact-head statuses, failures, and synthetic versus real-D1 evidence.

## Final integration
One scoped PR with RED/GREEN evidence and file/RPC/table impact. Review latest main for parallel overlap. Do not auto-merge, open public RPC, bind private D1 to previews or claim full M03 complete. Rollback: revert code-only PR; no data migration.
