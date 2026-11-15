# Superpowers TDD execution — M03 source date-only

**Authority:** `AGENTS.md`, `docs/WORKSTREAMS.md`, original `Utils.gs`, source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Branch:** `feat/m03-source-date-only-20261115`, fork fresh from `main` after merged #159.
**Design:** `docs/superpowers/specs/2026-11-15-m03-source-date-only-design.md`.

1. Inspect original Utils helpers and ongoing PRs. Confirm `isSettingEnabled_` already exists and M04/M06 phone helpers already exist; do not duplicate. Remain outside shared `src/db` and pending #168 `src/modules/source-time-only.js`.
2. Commit `tests/m03-source-date-only.test.mjs` first. Its Node VM oracle invokes the **original** `safeDateOnly_` and `formatDate_` with test-only GAS formatter/timezone simulation and checks fixed exact date outputs. Cover invalid source inputs and required explicit business IANA timezone. No implementation yet.
3. **RED:** GitHub Foundation fails on missing `src/modules/source-date-only.js` while prior tests pass. Record run/commit.
4. **GREEN:** Add only `src/modules/source-date-only.js` exporting pure `safeSourceDateOnly(value,timeZone)`. Explicit Intl timezone, no implicit UTC/Session, no new dependency.
5. Verify exact GREEN head via Foundation Node/source/build, M01 Chromium, M03 local real Workerd/D1, M04 auth local D1, M02 local import, Cloudflare PR safety. Acknowledge Workerd suite is regression-only for this unregistered pure function; it is not direct workerd coverage.
6. Compare main for concurrent changes; open/update scoped draft PR with RED/GREEN evidence, file/RPC/table inventory, blocked public cutover, rollback and checks. Leave PR for owner-reviewed merge, no automatic production enable.

**Files:** new spec/plan/test/module only. **Tables/RPC:** none. **Rollback:** revert PR.
