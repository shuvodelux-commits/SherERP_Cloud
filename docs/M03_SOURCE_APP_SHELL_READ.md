# M03/M09 — Source-shaped internal App Shell read

**Status:** Internal read-only compatibility port; NOT exposed as a public RPC. No live D1 binding or authentication activation.

## Pinned source contract

`legacy/source/UI.gs` `getAppShellData()` returns the legacy success envelope:
`{success:true,data:{shopName,currencySymbol,navItems}}`.

The `NAV_ITEMS` constant is a presentation tree, **not** the staff RBAC permission grid. Its original source keeps POS V2, Returns/Return History, Draft Sales, Customers/Suppliers/Vendors/Finance/Settings child routes, bilingual labels and `permKey`/`actionPermAny` hints. Permission checks remain the responsibility of authenticated backend operations; a visible tab never authorizes a transaction. Original `Config.gs` `CONFIG.APP_NAME` defaults to `Hardware Store ERP`.

## Internal implementation

`src/modules/source-app-shell-reader.js` exports `createSourceShapedAppShellReader(env).getAppShellData()`.

- `const NAV_ITEMS = [...]` is copied **byte-for-byte** from the pinned frozen `legacy/source/UI.gs` statement. No regenerated or altered menu, CSS, routing, or sidebar logic.
- D1 shop name and currency use the already reviewed `createSettingsReadAdapter(env).getAppShellSettings_()` fixed SQL selecting **only** `Shop Name` and `Currency Symbol`. No private Settings map is returned; original empty/missing fallback and Unicode text are preserved.
- Each successful call returns a **new structured clone** of the static NAV_ITEMS literal. A caller changing a nested label, children array or permission-display hint cannot affect later requests.
- No database write, broad Settings fetch, request cache, authentication bypass, derived permission grant, or fallback to live Sheets. Missing/failing D1 binding fails closed rather than inventing a successful UI payload.

## Verification

`tests/m03-source-app-shell-reader.test.mjs` uses a Node VM to evaluate the exact frozen original `NAV_ITEMS` literal and compare the resulting full tree and field order to the compiled port. An exact declaration span equality test catches accidental label/route drift. Additional unit tests cover two-key SQL projection, private-key exclusion, Bangla and currency display, absence fallback, deep-copy isolation, invalid D1 state and the unchanged disabled public RPC.

The existing nondeployable `tests/integration/m03-settings-workerd.spec.mjs` tests the reader against **real local Worker/D1**, with synthetic public and private Settings keys, fresh SQL updates, no writes and deep copy isolation. It runs via the existing M03 GitHub Actions workflow; no extra D1 fixture UUID or Cloudflare deployment binding.

## Remaining gates

The original browser `getAppShellData` call still returns HTTP **501** from the public Worker. Any future public read requires review of:
- static nav metadata and the display/privacy policy, including unauthenticated access, no rights implied by page visibility;
- a **separate, approved private D1 binding** for production, staff/session RBAC for protected operations, and approval of M02/M04/M10 import/cutover/rollback;
- original client bootstrap and authentication behavior, and end-to-end desktop/mobile/print parity.

This PR does **not** change `src/index.js`, `src/rpc/registry.js`, `src/rpc/handler.js`, original GAS/HTML/CSS, D1 migrations or public Worker config.
