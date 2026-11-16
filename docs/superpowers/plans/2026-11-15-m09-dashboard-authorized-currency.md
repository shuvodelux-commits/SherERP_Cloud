# Superpowers TDD — M09 Dashboard authorized currency

1. Pin original `Dashboard.gs::getDashboardStats` currency semantics and current M04 `auth_sessions` / `auth_users` / `auth_roles` contract. Avoid reading or making up the missing Products, sale or finance D1 tables.
2. **RED**: add native-GAS oracle + SQLite tests and isolated real local Workerd tests before the module exists. Confirm the expected missing-module failures in GitHub Actions.
3. **GREEN**: implement only `createM09AuthorizedDashboardCurrencyReader` with strict `{token,nowMs}` validation, Web Crypto token hash and one fixed parameterized, session-guarded `dashboard.view` SELECT of `Currency Symbol`. Authorized missing Settings yields original empty string. All uncertain outcomes deny.
4. Verify deterministic source output, Administrator and `dashboard.view` role, deny `settings.view`-only/other, revoked/stale/idle/expired sessions, role changes, no SQL on invalid requests, no private Settings leakage, no public Worker route, and unchanged D1 rows.
5. Re-run exact-head GitHub Foundation, isolated local Workerd/D1, M01 browser, M03/M04 checks and no-secret Cloudflare PR safety; document results, failed tests and gaps on draft PR. Keep M09 and production cutover incomplete.

**Affected (only):** new `src/modules/m09-authorized-dashboard-currency-read.js`; new `tests/m09-authorized-dashboard-currency.test.mjs`; new `tests/integration/m09-authorized-dashboard-currency-workerd.spec.mjs`; new `.github/workflows/m09-dashboard-currency-workerd.yml`; this plan and design. **No schema/RPC writes or migrations.** This doesn't authenticate or populate other 10 Dashboard fields.
