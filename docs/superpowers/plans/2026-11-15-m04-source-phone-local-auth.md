# M04 reviewed source-phone helper in local D1 authentication fixture

**Date:** 2026-11-15. **Workstream:** M04. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, frozen `Utils.gs`, `Auth.gs`, merged source phone identity PR #39 and D1 auth PRs #55/#60/#70/#73. Read `AGENTS.md` and `docs/M04_AUTH_SOURCE_CONTRACT.md` first.

## Design / problem

The local-only auth Worker fixture `tests/fixtures/m04-auth-worker.mjs` reimplements phone normalization inline as `testPhone`, despite the merged source-faithful helper `normalizeLegacyStaffPhoneSearch` from `src/auth/staff-phone-identity.js`. This creates two independently maintained normalizers at the precise boundary between original GAS form input and canonical D1 staff identifiers. Keep one source of truth, preserve the exact original `serverCall('login', mobile, password)` envelope, and make no public authentication changes.

## Minimal implementation

1. **RED first:** Extend `tests/integration/m04-legacy-rpc-workerd.spec.mjs` to assert the test Worker imports/uses `normalizeLegacyStaffPhoneSearch` instead of an ad hoc copy, plus real Workerd/D1 login with Bangla digits, lost leading zero, international prefix, malformed numbers and source-equivalent aliases. Run the new M04 GitHub Workerd workflow and capture the expected structural assertion failure. Existing source normalizer already owns and tests exact GAS parity; do not copy it.
2. **GREEN:** Replace `testPhone` in **only** `tests/fixtures/m04-auth-worker.mjs` with an import of `normalizeLegacyStaffPhoneSearch` and inject it as the trusted server-only `normalizeMobile` callback to the existing internal `createD1LegacyAuthRpc`. The D1 adapter continues to enforce canonical `^01[3-9][0-9]{8}$`, active staff/role, password and authority version checks.
3. Re-run the M04 real Workerd/D1 GitHub CI job and all other PR workflows. Check 29 or more tests, source 84/84, preserved original HTML build, no regressions, and a safe automatic preview. Don't fake success if CI remains red.

## Scope / ownership

Changed files are this plan, `tests/integration/m04-legacy-rpc-workerd.spec.mjs`, and `tests/fixtures/m04-auth-worker.mjs`. No `src/index.js`, `src/rpc/registry.js`, `src/auth/d1-auth-core.js`, D1 SQL, `migrations/`, `src/db/`, `legacy/source/`, Cloudflare Wrangler configs or workflow edits. **No remote D1 writes, no live staff data, no real login activation.** The preview stays D1-free with login 503 and business RPC 501.

## Next gates

Merge/review the independent offline staff/role preflight PR #42, M03 owner-approved auth schema migration and reconciled staff import, first-admin setup, IP abuse policy, protected staging-only RPC wiring, and end-to-end login proof before production rollout. Staff phone identity is distinct from Party identity.
