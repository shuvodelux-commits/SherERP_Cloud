# Superpowers TDD plan — M03 source desktop/mobile navigation parity

**Workstream:** M03 isolated UI shell model, no DB or Worker ownership.
**Branch:** `feat/m03-source-navigation-layout-20261115`, forked after #142 merged.
**Source SHA:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Spec:** `docs/superpowers/specs/2026-11-15-m03-source-navigation-layout-design.md`.

1. Verify latest GitHub `AGENTS.md` and `docs/WORKSTREAMS.md`, original `javascript.html` desktop/mobile logic, current `source-nav-visibility.js` contract, and overlap with other open PRs.
2. **RED:** Add `tests/m03-source-navigation-layout.test.mjs` first, evaluating the frozen original functions/constant via Node VM and checking return parity with explicit literal navigation matrices. Commit without new implementation. Verify expected missing export using GitHub Foundation Actions run.
3. **GREEN:** Extend only `src/modules/source-nav-visibility.js` with `projectSourceNavigationLayout(navItems,profile,currentPage)`, reusing role projection, and no copied source menu. Keep results JSON-safe and detached. Commit.
4. Validate exact GREEN head via Foundation (Node, pinned sources, frontend assembly), Cloudflare PR safety, M01 Chromium, M03 real local Workerd/D1, M04 auth real D1, M02 identity and local D1. Review diff vs latest `main`, report any missing evidence truthfully.
5. Open scoped PR with file/RPC/table impacts, test evidence, remaining public-RPC/authentication blockers and rollback. Leave approval/merge to owner.

Rollback: revert new export, test and docs only; no schema/remote data touched. Follow KISS, source parity, and zero frontend redesign.
