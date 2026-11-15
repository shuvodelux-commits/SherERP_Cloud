# M04 internal staff-permission policy — design (2026-11-15)

**Status:** isolated security preparation, review required; does not enable authentication.

## Intent
Begin a separate M04 implementation slice while M01 QA, M02 importer checks and M03 D1 work proceed independently. Port the pure, source-defined staff permission normalization contract into an internal JavaScript module and prove it matches the pinned source's module and date-window vocabulary. The code must remain unreachable from public Worker RPCs.

## Source and constraints
- Authoritative snapshot: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, mirrored at `legacy/source`.
- `RoleManagement.gs::sanitizePermissions_`, `UI.gs::PERMISSION_MODULES` (21 explicit rights), `Auth.gs::DELETE_WINDOW_OPTIONS` (8 window keys).
- Preserve `editOnly` rights (`openingBalance`, `settlementDiscount`), management-delete boolean semantics (`users`, `roles`), and source-compatible legacy `backdate: "unlimited"` fallback. **That fallback is not authorization to enable live permissions.**
- Zero changes to `src/db`, schema, Worker entrypoint, RPC registry, migrations, browser HTML, Cloudflare configs, Party accounts or finance.
- Source roles are **staff** authorization roles; never mix with the Unified Party's seven relationship roles.

## Approaches
1. **Chosen — pure internal sanitizer plus source parity tests.** Makes measurable progress; no DB dependencies or deployed behavior.
2. Tests and architecture notes only. Safe, but the actual independent M04 helper remains undefined.
3. Live auth/D1 sessions. Rejected: depends on M03/M02 kernel and reviewed expiry, throttle and credential policies.

## Design
New `src/modules/auth/permission-policy.js` exports:
- `STAFF_PERMISSION_MODULES`: fixed allowlist of `{key, permissionMode?}`, copied exactly from UI.gs with explicit tests for drift.
- `PERMISSION_WINDOW_CODES`: the eight original window keys, with a source-snapshot parity test.
- `sanitizeStaffPermissions(raw)`: allowlist-only own-data properties, normalized booleans, strict edit-only behavior, management delete booleans, valid date windows, the legacy backdate default, and no unknown/prototype-derived grants. Return a plain JSON-serializable map.
- `allowedStaffModules(normalized)`: ordered view-enabled module names; no edit-only or delete-only navigation grant.

The GAS original accepts truthy strings and inherited properties for booleans. This internal port **deliberately tightens** these to literal `true` and own data properties, to avoid client-crafted false grants; golden tests document the difference. This is subject to review before activation; do not silently reinterpret historical stored role JSON.

## Acceptance
- RED→GREEN module tests validate exact module and window source vocabulary, unknown/inherited denial, edit-only, management deletes, strict booleans, invalid/valid windows, and view-only allowed modules.
- `npm test`, `npm run verify:source`, `npm run build:frontend`, `git diff --check` pass on the isolated branch.
- Existing `tests/m04-auth-preflight.test.mjs` continues to prove auth endpoints return 501.
- A small PR documents source and database/RPC zero-impact boundaries. No merge/deploy as part of this slice.
