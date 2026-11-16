# M09 — Dashboard currency from an authorized isolated D1 read

**Authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Dashboard.gs::getDashboardStats`, current `AGENTS.md` and M04 session/role authority rules.

## Goal

Return only the original Dashboard's `currencySymbol` scalar from the already-reviewed isolated `settings` table. This is **one incremental trusted input** for a later complete Dashboard read-model composition; it is not `getDashboardStats`, a public RPC or permission to query incomplete Products/Finance data.

## Contract

`createM09AuthorizedDashboardCurrencyReader({DB}).getCurrencySymbol({token,nowMs})` returns a string (source `settings['Currency Symbol'] || ''`) for a valid session granted **literal dashboard.view**, including Administrator. A role with only `settings.view` or `reports.view` must not qualify. A single SQLite statement both verifies current M04 user/session/role/credential epochs, expiry, inactivity, revocation and scoped grant and reads the one setting; a JS authorization preflight followed by another query is forbidden. Denial, SQL errors and malformed D1 data fail closed without returning a currency.

Use server-derived token and clock only; reject spoofed fields/accessors and noncanonical bearer tokens before any D1 access. Preserve Bengali Unicode, empty/missing setting defaults, no state/caching/side effects. Existing M04 schema is **test-only, single-business, non-tenant**, so do not expose this reader in `src/index.js`, `src/rpc`, or Cloudflare previews.

## Scope and gates

New standalone M09 module, tests, test-only PR workflow and spec/plan. No shared `src/auth`, `src/db`, migrations, source GAS, frontend HTML/CSS/JS, Cloudflare bindings, finance postings or live database. Native frozen-source oracle, Node SQLite M04 authorization tests and real isolated Workerd/D1 tests must pass. All GitHub exact-head checks and owner review before merge. `PARALLEL-MODULE-READY=false`; rollback by reverting additions.
