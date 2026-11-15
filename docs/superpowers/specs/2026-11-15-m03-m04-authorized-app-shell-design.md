# M03/M04 — Internal authorized application-shell envelope

**Authority:** Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`UI.gs#getAppShellData`, `NAV_ITEMS`), merged M03 source reader (PR #124), and M04 single-statement `settings.view` adapter. This is a next increment of that approved internal shell work, not public RPC activation.

## Intent and invariants

Provide `createM04AuthorizedAppShellReader(env).getAppShellData({token,nowMs})` to a **trusted server caller only**. An existing active M04 D1 session with an Administrator role or current `settings.view === true` grant gets the original `{success:true,data:{shopName,currencySymbol,navItems}}` shape. A revoked, expired, wrong-epoch or unauthorized session gets no shell response. The session's role is checked in the same D1 SQL statement as the two-key projection, not in a separate JavaScript preflight.

Reuse `createM04AuthorizedShellSettingsReadAdapter(env)` and reuse the already byte-for-byte source-pinned M03 `NAV_ITEMS` in `source-app-shell-reader.js`; do not copy a second navigation tree or re-derive permissions from menus. Each call gets a deep-cloned navigation tree. Preserve Bangla text, POS V2 route, source defaults and legacy result key order. The navigation tree is presentation metadata, never a permission grant. Return no private Settings values or session/role columns. No global cache or new dependencies.

## Approach

Prefer a tiny pure `buildSourceAppShellData(settings)` projection exported from the existing M03 source reader and called by both the original internal reader and one new authorized wrapper. Alternatives rejected: (a) duplicating `NAV_ITEMS` risks drift; (b) calling the unguarded reader after a separate session check creates a permission time-of-check/time-of-use gap; (c) opening `getAppShellData` on the public Worker requires separate M04/M10 security and production deployment approvals.

## Explicit boundaries

Only source-reader function extraction, a new internal adapter, Node source-oracle tests, existing isolated Workerd/D1 suite extension, design/plan. **No** `src/index.js`, `src/rpc/**`, `legacy/**`, migrations, production/staging D1 bindings, previews, Cash/Bank, UI/CSS, or third-party packages. Existing public `getAppShellData` remains HTTP 501; original pre-login branding cannot yet use this authenticated internal read. Isolated M04 test auth schema remains single-business only; no shared-tenant claim.

## Acceptance

Node RED then GREEN on missing adapter; compare full navigation to frozen source; verify exact shell envelope, one guarded SQL, no private columns, no cross-request nav mutation, invalid/denied bearer failure, fresh Settings data. Local Workerd+D1 test verifies real session/role permission enforcement, revocation and both public route restrictions. Full GitHub Node, M03 Workerd, source pin, browser and Preview safety checks must be reported from the exact PR head. Roll back by reverting the code-only PR; no data migration.
