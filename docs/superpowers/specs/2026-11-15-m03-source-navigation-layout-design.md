# M03 — Source desktop/mobile shell layout projection

**Authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; frozen `legacy/source/javascript.html` navigation routines `sidebarItemsInOrder_`, `navLandingKey_`, `buildNav_`, `buildMobileNav_`, `syncMobileNavigation_`, `navGroupFor_`, and `MOBILE_PRIMARY_KEYS_`. Existing internal source-shaped M03 app shell #124, authorized app shell #134, source role navigation #142.

## Problem and bounded approach

Existing M03 `projectSourceNavigation(navItems,profile)` preserves role-visible menu and tab metadata but does not reproduce source-specific desktop sidebar order, group separators and mobile bottom-rail / More-sheet routes. Preserve the **original source behavior** as a pure, internal-only display projection without changing original HTML/JS.

Add `projectSourceNavigationLayout(navItems,profile,currentPage)` to `src/modules/source-nav-visibility.js`. It should call existing `projectSourceNavigation` once; it should **not** copy NAV_ITEMS or derive permission flags independently.

Expected return:
```js
{
  desktop: [{key,landingKey,dividerBefore}],
  mobile: {
    primaryVisibleKeys: ['dashboard', ...],
    more: [{key,landingKey}],
    activeKey: 'dashboard' | 'pos' | 'sales' | 'products' | 'more',
    activeMoreKey: string | null,
  }
}
```
- Desktop: original `sidebarItemsInOrder_` ascending numeric `sidebarOrder` (unavailable/non-finite values sort last with 9999), stable ties; divider before entries whose numeric `sidebarGroup` differs from prior, except first.
- Mobile: source fixed primary keys `dashboard,pos,sales,products`; only role-visible primary buttons are visible, in source bottom-rail order; More entries preserve *source filtered NAV_ITEMS order*, **not** the sorted desktop order; targets use the exact prior source-visible landing model. Active bottom button matches original `syncMobileNavigation_` using full `navGroupFor_`, default to `more`. Active More entry matches a More target's parent group. Unknown `currentPage` behaves like source (More, no highlighted More entry).
- No input mutation, mutable cache, client auth trust, HTML changes, new RPC, DB reads/writes, or tenant/binding changes. The source's browser remains the runtime owner; this is an internal parity artifact for future reviewed cutover.

## Test & safety contract

Test-first with `tests/m03-source-navigation-layout.test.mjs`: execute original functions and literal NAV_ITEMS from frozen files in Node VM, compare behavior for Administrator, cashier/POS, Returns, Settings, Counter-only and no-access profiles; verify ordering, divider, mobile vs desktop distinction and unusual/unknown currentPage. Test defensive invalid profile and navigation inputs. RED from missing export; GREEN via minimal code. Existing M03 and all GitHub Actions checks remain green. No impact on source repository, public RPC (still HTTP 501), production D1, financial posting, original browser handlers, or CSS.

**Review gate:** PR with plan, RED/GREEN evidence, file inventory; no automatic merge and no claim of M03 completion.
