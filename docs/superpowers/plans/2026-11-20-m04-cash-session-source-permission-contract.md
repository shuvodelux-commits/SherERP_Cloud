# M04 Run 3 — frozen Cash Session source-permission contract (offline)

**Status:** Test-only source contract; not a staff authorization implementation, operational SQL or permission to merge M04 #737.
**Repository:** shuvodelux-commits/SherERP_Cloud.
**Workstream:** M04 #23/#252; coordination #456, M03 #22 and M08 #66.
**Frozen original:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, pinned `legacy/source/CashSession.gs`.
**Starting main:** `2536640a9f6e6b6c409486b26e545c501cfa4a6a`.
**Active M04:** PR #737 remains **open/unmerged** at initial GitHub read. This PR is independent and must not cherry-pick or modify #737.
**Exclusive paths:** this NEW plan, NEW `tests/m04-cash-session-source-permission-contract.test.mjs`, NEW `src/auth/m04-cash-session-source-permission-contract.js`. No overlap with M01/M03/M08/M10 or #737.
**Prohibited edits:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, `wrangler*.jsonc`, existing M04 auth tests/fixtures, worker bindings, private/remote D1, historic source, original HTML, shared CI, financial SQL.

## 12-sentence implementation overview

1. Previous M04 #729 established a synthetic SQL Cash Session gate and #737 independently tests current internal M04 auth tables.
2. The original CashSession.gs source is authoritative for Cash Session UI actions, but neither proof validates its exact action-to-role permission mapping.
3. In the frozen source, `startCashSession` checks `requirePermission_(token,'pos','add')`.
4. The `closeCashSession` operation checks the same `pos.add` grant instead of `pos.edit`.
5. The `getCashSessionSummary` method requires `pos.view`.
6. Internal `getActiveCashSession_` and `requireActiveCashSession_` must not be promoted into browser RPC names.
7. Transaction posting requires a session whose status is exactly `Open`, and `Starting`, `Closing`, `Closed` or missing sessions must not pass the check.
8. The original source distinguishes a closing retry from an ordinary posting request, and its read-only reporting excludes historical opening from turnover.
9. A pure offline inspector will parse the pinned JS source with the repository's existing Acorn dependency rather than trusting manually copied function names.
10. It will reject missing or duplicate functions, changed permission calls, extra calls, forged source tokens, or loosened `Open` status checks and return a redacted, nonauthorizing contract result.
11. Test-first RED creates the test file before the inspector and is verified by the existing Foundation GitHub Actions job, then GREEN implements the minimal inspector and runs all exact-head CI.
12. The inspector itself **never authenticates**, **never grants**, **never posts**, and hands its source-derived contract to the M03 SQL integrator only after review and owner-approved action-policy decisions.

## Separation of evidence and release

- The frozen source is NOT modified. Tests use exact pinned source bytes via `readFileSync`.
- Administrator may bypass role grants under the original Auth.gs rule, but the proposed SQL writer must still enforce current authenticated session, actor and status.
- Per-Shop Cash Session ON/OFF is an **owner-approved new-shop extension**, not a feature inferred to exist in historical GAS; turning OFF must never permit unauthenticated transactions.
- This extractor is offline information; an actual authorized mutation must still enforce a single SQL-time M04 session/role/permission/Cash Session check, not a JavaScript preflight.
- M08 money policy and M02 financial identity source reviews remain blocking. Historical opening amounts must not become current cash turnover.
- No live financial writers, public RPC, staging/production data import, cloud binding or release sign-off.
- Independent `/super qa` and `/super review`, full CI at exact head and owner-approved merge; do not merge automatically.
