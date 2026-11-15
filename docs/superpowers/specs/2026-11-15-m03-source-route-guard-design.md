# M03 — Frozen source page-route projection

**Authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen `legacy/source/javascript.html` `goToPage` guard, `navGroupFor_`, `firstReachableKey_`, `moduleHeaderFor_`, `renderSubNav_`, `subNavVisible_`; frozen `legacy/source/UI.gs#NAV_ITEMS`.

## Goal

Continue internal M03 application shell parity after merged #124, #134, #142, #148. The original browser permits staff page navigation only when its source permission-display rules allow it; otherwise it redirects to `firstReachableKey_` or `noAccess`. Administrator and explicit `noAccess` inputs retain source behavior. Preserve the original grouped header, bilingual text, rendered subtab strip, and POS V2 runtime alias.

Implement **one pure export** `resolveSourceNavigationRoute(navItems, profile, requestedKey)` in the existing internal `src/modules/source-nav-visibility.js`, returning:
```js
{pageKey, runtimeKey, parentKey, moduleHeader:{title,bn}, subTabs, posV2Active}
```
`subTabs` are **visible** children of the selected group, and are empty if fewer than two (original `renderSubNav_` hides the strip). `parentKey` uses `navGroupFor_` from the unfiltered source navigation, as the original highlights the group containing Returns/Users/Roles. A POS V2 route renders the original `pos` page runtime container.

**Design selection:** reuse `projectSourceNavigation` for all role display-filtering; locate `navGroupFor_` on the pinned original provided tree, mirror the explicit original route guard, and return a detached display-only model. Do NOT import or duplicate NAV_ITEMS, touch frontend/Worker/RPC/DB, or derive server permission from navigation.

**Valid profile:** exactly as previously verified by the existing `projectSourceNavigation` (Administrator `allowedModules:null`, or staff allowed array and explicit permissions). Unknown admin route is allowed in the original browser; unknown staff route falls back. Original source does not reject unrecognized strings; preserve that behavior for exact source parity. Do not expose this as a public RPC or promise authentication; a caller-controlled profile cannot establish authorization.

## Acceptance and safety

- A Node VM source oracle evaluates the **original** `goToPage` guard statement and source `moduleHeaderFor_` / `renderSubNav_` logic on frozen NAV_ITEMS.
- Cases: Administrator, cashier, Returns-only, Settings-only, Users-only, Counter action-only, unknown/blocked routes, `noAccess`, POS V2 alias, subtab visibility and no input mutation.
- TDD RED on missing export, GREEN minimal implementation, all exact-head Foundation, original UI/Chromium, M03/M04 local Workerd+D1, Cloudflare PR safety and staging-local checks.
- **Files:** this spec, Superpowers plan, one Node source-oracle test, one existing internal module. **RPC/table impact:** none. No `legacy/**`, `src/db/**`, migrations, SQL, Worker, Cloudflare config, production, remote D1 or unrelated workstreams. Roll back by reverting code-only PR.
- Keep public `getAppShellData` HTTP 501 and `PARALLEL-MODULE-READY` blocked pending the original M03/M04 data-plane and security gates.
