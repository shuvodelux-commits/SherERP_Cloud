# M04 — Fail-closed D1 login when staff role navigation and view permissions disagree

**Source authority:** original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `RoleManagement.gs` (`Allowed Modules` derived from `permissions[module].view`), `Auth.gs`. **Target base:** `SherERP_Cloud/main@8bb3ae82731fcce5e60ebaf26a2a5da71c376766`. Follows AGENTS.md, M04 source contract, ADR-007 and the existing protected staff-export runbook.

## 12-sentence design overview

1. The original role writer builds `Allowed Modules` from the set of modules with `view===true` in the stored staff permission map.
2. The existing protected source-import preflight already rejects any discrepancy between that set and the source `Allowed Modules` list.
3. After a local D1 role has been imported or edited, the internal auth login bridge currently validates field types but does not recheck this invariant.
4. A corrupted D1 row can therefore return source-inconsistent visible navigation to the client even though server permissions remain independently guarded.
5. The next M04 slice adds a small fail-closed role-visibility consistency check at the **internal** D1 auth profile read boundary.
6. For Administrator, existing `null` role metadata behavior stays intact and no custom role row is needed.
7. For other roles, the visible module *set* must equal precisely the set of permission entries whose `view` is the Boolean `true`, independent of ordering.
8. Existing valid custom roles with add/edit/delete/backdate rights but no view right must continue to work.
9. Invalid or mismatched D1 roles must cause an initial login to fail with the established generic `Sign-in role configuration is unavailable.` response and revoke the freshly issued session.
10. No invalid role or client-selected navigation list may become a permission to execute server RPC methods.
11. Real disposable Workerd/D1 tests reproduce mismatched stored role data (including a valid non-view grant) before the code change and prove rejection and session revocation afterward.
12. This does not enable public login, alter the existing token-digest PR #293, touch protected source exports or authorize a remote D1 migration.

## Impact and Superpowers acceptance

- **Modified:** `src/auth/d1-legacy-rpc.js`, only in the D1 profile validation path, no SQL or new dependency.
- **Test:** existing `tests/integration/m04-legacy-rpc-workerd.spec.mjs` with a new synthetic invalid source-role row and isolated user; the already configured M04 Workerd job runs it.
- **No changes:** original GAS, public `src/index.js` / `src/rpc/registry.js`, other auth modules including `session-token.js`, SQL migrations, Cloudflare config, Party roles/accounts, funds or stock.
- **RED:** prove current internal D1 login incorrectly accepts role navigation inconsistent with its view grants (and leaked session).
- **GREEN:** reject corrupted role metadata, revoke new session and keep all existing valid grants and source-shaped login behavior unchanged; verify exact-head CI.
- **Rollout:** test-only local D1; owner review before PR merge. Production login remains intentionally unavailable pending M04 approval and PR #293 resolution.
