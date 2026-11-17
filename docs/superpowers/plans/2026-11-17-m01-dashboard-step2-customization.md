# M01 Dashboard Step 2 of 3 — Customization and Arrangement

**Issue:** #567 · **Source:** merged UI PR #570 · **Base main:** `892115db23b9dead40dce9ed1c69b536d11c0b6c`
**Workstream:** M01 UI-only; no D1, finance, RPC, Worker entry or frozen `legacy/source/**` edits.
**Owned files:** `src/ui/hisabiq-dashboard.html`, `tests/m01-hisabiq-dashboard.test.mjs`, `qa/m01-browser.spec.mjs`, this plan.
**Other open M01 PR:** #581 only touches Products preview and `package.json`; neither is edited here.
**Dependencies:** approved dashboard parity issue #567; M09/M03/M04 business read data remains separately blocked and is not in scope.

## Twelve-sentence implementation overview

1. Step 2 completes the existing HisabIQ-like dashboard customization instead of adding a competing dashboard component.
2. Users can enter Customize, hide/show widgets individually, restore hidden items, and see how many are hidden.
3. Each visible dashboard card and panel gets accessible move-earlier, move-later and hide actions in edit mode.
4. The All Widgets dialog shows every metric/panel, including hidden optional SherERP metrics, in saved order.
5. Mouse users can reorder within their widget group with native drag-and-drop.
6. Touch users can reorder from the grip with Pointer Events, with accessible move buttons as a robust alternative.
7. Keyboard users can reorder directly using Up/Down on the grip or labeled Up/Down buttons, and can toggle switches with Space/Enter.
8. We keep focus on the corresponding control when re-rendering a list and announce layout actions through a polite live region.
9. The dialog traps focus, restores the invoking control when closed, supports Escape and backdrop dismissal, and does not permit background interaction.
10. Layout IDs, order and visibility persist using a user and shop/tenant-scoped key, preserving valid saved v1 layouts, ignoring unknown/malformed/duplicate IDs and appending newly introduced widgets.
11. Authentication changes, logout and account switches reset in-memory layout state before additional editing can persist to the previous actor's storage.
12. Node structural and Chromium desktop/mobile/touch/keyboard/account-isolation tests must be RED before implementation, GREEN afterward, with all current-head CI required before merge.

## Acceptance criteria

- [ ] Reorder metrics **and** panels by mouse, touch and keyboard, without crossing groups.
- [ ] Reorder hidden widgets in dialog; visible grid and panel order reflect changes.
- [ ] Hide/show/reset and All Widgets controls persist through reload and correctly count hidden widgets.
- [ ] Identity changes do not leak another user or tenant's arrangements; logout clears editing/modal state.
- [ ] Corrupt saved JSON, unknown widget IDs, duplicates and partial layouts fall back safely.
- [ ] Switch, drag handle, move buttons and dialog have accessible names and focus lifecycle.
- [ ] No fabricated financial figures, no new backend paths, no regressions in existing desktop/mobile/print UI.
- [ ] Playwright screenshots at 390 and 1280 plus full GitHub CI evidence.

## RED→GREEN and release

- RED evidence: tests committed first on this dedicated branch, captured job results.
- GREEN evidence: next implementation SHA and current-head GitHub Actions workflow URLs.
- Rollback: revert this PR, leaving merged visual Step 1 intact.
- **Step 3 remains separate:** source-faithful navigation, authorized record drilldowns and final UI acceptance.
