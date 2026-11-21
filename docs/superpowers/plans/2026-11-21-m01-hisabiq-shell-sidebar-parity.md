# M01 — HisabIQ application-shell and sidebar visual parity
Date: 2026-11-21 · Branch: `m01/hisabiq-shell-sidebar-parity-20261121`

## Source lock and scope
- Target `SherERP_Cloud/main@71aabc8961c920f3c87ec1c7be4d069316e21c73` (refresh before merge); reference `hisabiq_ui/main@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`.
- Exact reference: `src/components/layout/{AppShell,Sidebar,ErpNavMenu,TopBar}.tsx`, `src/navigation/useVisibleErpNavigation.ts`, `src/theme.css`.
- Keep SherERP HTML/CSS/JS, `NAV_ITEMS`, `filterNavByRole_`, `subNavVisible_`, `goToPage`, `renderSubNav_`, session, business name, cash-session and RPC integrations. Do not add a React runtime or new permission/router.
- Do not modify `legacy/source`, DB, migrations, M03/M04, Party, Products or POS feature code, existing auth or the other workstreams' files.

## Design / acceptance
1. Compiled-only additive shell enhancement: desktop >=1024px fixed/in-flow nav width 256px expanded or 64px collapsed, 56px header, accessible sidebar width trigger, persisted icon rail, Ctrl/Cmd+B, section labels and children for active group, compact typography/teal selected state, motion and reduced-motion behavior.
2. Under 1024px: same permission-filtered navigation in left drawer with backdrop, Escape, focus trap and focus restoration, scroll lock, resize dismissal and no viewport overflow; preserve existing quick bottom navigation on phones.
3. Source-authorized child links must invoke existing `goToPage` and not create a new routing path. Parent group state and nested child selected state must follow the current route; existing top subnav stays operational.
4. Every original shell ID, original login/logout, cash-session controls, refresh, calculator, day book/printing, and signed-in user footer remains live. No unsupported business-switch behavior is invented.
5. CSS scoped to compiled shell; never change financial pages or print behavior.

## Superpowers RED/GREEN plan
- Tests first: build patch idempotence and source anchors; Playwright role-filtered keyboard and pointer navigation, widths 1440/1024/768/390, sidebar persistence, collapsed icons and mobile drawer focus.
- Baseline screenshots before UI changes in synthetic browser fixture. Reference screenshot if Vite dependencies/browser become available. Confirm failure of at least one new assertion.
- Minimal implementation in `scripts/patch-hisabiq-shell.mjs`, `src/ui/hisabiq-shell.css`, `src/ui/hisabiq-shell.js`, integrated only through `scripts/build-frontend.mjs`.
- Run tests/compiled owner build/legacy regressions, screenshot after, visually inspect desktop/tablet/mobile, document remaining differences. Do not claim D1 or authenticated hosted coverage from synthetic browser tests.
- PR only, no production deployment or automatic merge.

## Design alternatives
- Rebuild in React: rejected, violates target source/permissions and increases release risk.
- Edit pinned legacy HTML/JS directly: rejected, risks original migration/source equality.
- **Chosen:** compiled-only enhancement preserving original DOM identifiers and navigation functions with scoped CSS and no new backend.
