# M04 — Frozen source Roles bootstrap UI option metadata (internal only)

Date: 2026-11-15
Workstream: M04 authentication and authorization
Dependency: merged PR #249 (read-only internal Roles preview)
Source revision: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

## Source contract
- `legacy/source/RoleManagement.gs::getRolesBootstrap` guards `roles.view` via `requirePermission_` then returns `roles`, `moduleOptions` and `deleteWindowOptions`.
- `UI.gs::PERMISSION_MODULES` defines **21** ordered `{key,label,permissionMode?}` values, with special `openingBalance` and `settlementDiscount` edit-only rights and independent `returns` and `posCost` choices. The source response maps missing `permissionMode` to an empty string.
- `Auth.gs::DELETE_WINDOW_OPTIONS` defines eight ordered `{key,label}` values: disabled/same/1/3/7/15/30/unlimited.
- `src/modules/auth/permission-policy.js` already pins corresponding keys and window codes, but lacks the actual display labels. `src/auth/d1-role-directory.js` currently returns `{authorized,partial,roles:[{name,status}]}` and no option metadata.

## TDD / implementation
1. Write RED tests against immutable original source arrays by extracting/evaluating only the two literal array constants (using existing `sourceConstant` helper) and comparing **exact order, names, labels, permissionMode strings and window options** to a new pure `roleBootstrapOptions()` function.
2. Extend the existing real local Workerd/D1 Roles directory acceptance test to require `moduleOptions` and `deleteWindowOptions` exactly matching frozen source, including `returns` and `posCost` and edit-only flags; denial must still return only `{authorized:false}`. Verify tests fail on GitHub CI before production modification.
3. Minimal GREEN: add static labels for the existing canonical 21 keys and eight window codes in `permission-policy.js`, expose `roleBootstrapOptions()` returning fresh JSON-safe arrays; call it only after the D1 roles.view check in the **internal** `d1-role-directory.js` preview. Never select/return stored roles permission JSON or auth epochs.
4. Run real Workerd+D1, unit/Foundation, M01 Chromium, Cloudflare PR preview-safety and affected CI; record RED/GREEN commit evidence in draft PR.

## Ownership / hard gates
M04 owns `src/modules/auth/permission-policy.js`, `src/auth/d1-role-directory.js` and dedicated M04 tests/docs. No new deployment dependencies, no production `src/index.js` or RPC registry modification, no remote D1, no `src/db/**` or schema/migration edits (exclusive M03), no customer/Party/financial writes, and no frozen source changes.

The Roles preview remains `partial:true`: original role IDs, Created At and complete source role row data are not in the isolated auth D1 fixture. UI labels are not permission decisions; staff role access still depends solely on trusted D1 `roles.view`. Do not claim public `getRolesBootstrap` parity until M03 reconciliation, full authorization review and explicit activation.
