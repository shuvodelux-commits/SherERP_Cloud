# M03/M09 source-shaped internal application shell projection

**Source of truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/UI.gs` `NAV_ITEMS` and `getAppShellData()`; `legacy/source/Config.gs` default `CONFIG.APP_NAME`; reviewed `src/db/settings-read.js`.

## Goal
Complete the original read-only shell payload as **internal** `createSourceShapedAppShellReader(env).getAppShellData()`:
`{success:true,data:{shopName,currencySymbol,navItems}}`.
- Reuse `getAppShellSettings_()` SQL that selects **only** `Shop Name` and `Currency Symbol`. Preserve original empty/missing fallback values, Unicode and string fidelity.
- Copy `NAV_ITEMS` source statement **byte-for-byte**, no reconstruction from permission grid or frontend display; preserve keys, children, `permKey`, `actionPermAny`, labels, Unicode and ordering.
- Return fresh cloned tree each call so a caller cannot corrupt later responses. No process-level auth, D1, Settings or navigation-state cache; the static source list is immutable by convention.
- Deny all operations without actual trusted D1 binding; propagate D1 failures rather than forging success.
- No new dependencies; no public API / RPC activation. Do not call `createSourceShapedAppShellReader` from `src/index.js`. The RPC `getAppShellData` stays 501 until an explicit security, deployment and public-read review.
- In future, authenticated UI navigation visibility must still be filtered by the original server-derived permission policy. Returned navigation is **display metadata, not permission authority**.

## Acceptance
- Source oracle test loads the frozen `NAV_ITEMS` directly from `legacy/source/UI.gs` in Node VM; compares full JSON tree to newly compiled module, and confirms the copied const declaration is exact text equality.
- Synthetic DB test proves the only SQL settings read is `Shop Name` and `Currency Symbol`, no Phone, Email, Invoice Logo, delete keys or user secrets; initial and updated results reflect current DB values.
- Real local Workerd/D1 test on existing synthetic `wrangler.m03-settings-test.jsonc` verifies values/fallback, privacy, mutation isolation and no public route.
- Existing `AGENTS.md` and M04 security gates remain intact. This code does **not** authorize live staff/login/data migration, staging/private D1 binding on publicly accessible Preview, Settings editing, or hidden frontend changes.

**Changed production files:** one new internal `src/modules/source-app-shell-reader.js`. No frozen GAS, SQL schema, auth, role or posting kernel, public worker, routing, previews, frontend CSS/JS, or developer tooling changes.
