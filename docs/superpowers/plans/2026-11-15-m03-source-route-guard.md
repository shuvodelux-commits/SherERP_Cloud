# M03 source route guard — Superpowers TDD execution

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `legacy/source/javascript.html` and `UI.gs`.
**Workstream:** M03 UI-shell parity only; exclusive DB/Worker/schema owner remains M03-core. **Branch:** `feat/m03-source-route-guard-20261115`.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-source-route-guard-design.md`.

1. Inspect merged `AGENTS.md`, `docs/WORKSTREAMS.md`, `src/modules/source-nav-visibility.js`, original browser `goToPage`, `firstReachableKey_` and subnav, open PR overlap. Verify no `src/db` ownership collision.
2. Commit `tests/m03-source-route-guard.test.mjs` that executes exact frozen UI NAV_ITEMS and original browser functions in Node VM. Build an oracle from the original `goToPage` guard slice up through `currentPage = key;`, source `navGroupFor_`, `moduleHeaderFor_` and subtab filtering. Assert role navigation, source-facing fields and no mutation. **No implementation yet**.
3. **RED evidence:** GitHub Foundation fails solely on missing export `resolveSourceNavigationRoute` with other baseline tests passing.
4. **GREEN:** only extend `src/modules/source-nav-visibility.js` to export `resolveSourceNavigationRoute(navItems,profile,requestedKey)`, reusing existing source-visible groups; no new packages/frameworks.
5. Verify exact GREEN head: Node suite and pinned sources, frontend includes, M01 Chromium, M03 workerd D1, M04 auth D1, M02 local D1 and Cloudflare PR safety. Investigate any failure rather than claiming green.
6. Review latest `main` overlap, PR impact inventory, RED/GREEN logs, exact SHA; leave branch in PR for owner-reviewed merge. Do not activate live RPC or production.

**Rollback:** revert this isolated code-only PR (no migrations/data changes). Scope excludes auth binding or runtime route replacement.
