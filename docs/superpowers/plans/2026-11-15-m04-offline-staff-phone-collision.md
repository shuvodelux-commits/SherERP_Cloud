# M04 — Offline staff phone-identity collision preflight

Date: 2026-11-15. Workstream: M04 authentication. Source: pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Mandatory: `AGENTS.md`, `docs/MIGRATION_PLAN.md`, `docs/M04_AUTH_SOURCE_CONTRACT.md`, `docs/WORKSTREAMS.md`; merged PR #39 staff phone normalization, #42 staff import preflight, #97 real D1 login normalization.

## Problem and design

`auditLegacyStaffImport(users,roles)` validates each source `USERS["Mobile Number"]` field for *presence and type only*. It does not reject two distinct staff IDs that normalize to the same phone (e.g. `017...`, `+88017...`, Bengali digits or numeric 10-digit Sheets-damaged phones). As a result its `preflightPass:true` may authorize an offline import proposal that the D1 auth identity `phone_key` uniqueness constraint cannot safely reconcile, or that could lead to wrong-account login. The same audit currently treats the string `hello` as valid phone because it is nonblank. **Do not** guess which source staff identity owns a shared phone, auto-merge staff or link Parties.

## Minimal chosen solution

Use the already-source-tested `normalizeLegacyStaffPhoneSearch` helper from `src/auth/staff-phone-identity.js`. In the existing full-roster pass, accept only source values of valid type (existing rule), normalize using the pinned GAS helper, then require the canonical D1 staff identifier `/^01[3-9][0-9]{8}$/`. Report the fixed, no-secrets code `USER_MOBILE_UNSUPPORTED` for otherwise nonblank source numbers that cannot be represented as a canonical D1 phone. Maintain a Set of canonical staff keys and report `USER_MOBILE_DUPLICATE` on every subsequent alias, including inactive users. Preserve original IDs/rows, do not mutate input, do not use Party identity; no credential material or raw phone returned. A separate `USER_MOBILE_INVALID` remains for missing/invalid value types. No new user-visible schema or login/RPC access.

Alternative rejected: use `findUniqueLegacyStaffPhone` per row, which is O(n²) and expects complete raw roster; a single O(n) Set is simplest with identical source normalization. Alternative rejected: silently choose first row or dedupe/merge by phone.

## Superpowers TDD

1. **RED:** extend `tests/m04-staff-import-audit.test.mjs` with cases for `017...` vs `+880...`, Bengali digits, safe numeric 10-digit aliases, duplicate inactive staff, unsupported strings/international numbers, preserved distinct valid users, privacy of fixed-code report. Open draft PR and observe `Foundation source checks` failure on GitHub before production edits.
2. **GREEN:** only modify `src/auth/staff-import-audit.js` to import and reuse reviewed normalization helper and add canonical validation + collision detection. No second parser, no unknown dynamic fields or long-lived cache.
3. Recheck GitHub `Foundation source checks` and M04 real Workerd/D1 CI (plus all other PR checks), preserve original 84 source files and 36 frontend includes; inspect exactly three changed files: this plan, focused test and M04 preflight module.
4. Draft PR with RED/GREEN links, test counts and deployment restrictions. No merge until CI reviewed.

## Boundaries

Offline audit of an **owner-authorized complete** legacy `USERS`/`ROLES` export only. No real staff import/export, no secrets in git, no source UI changes, no `migrations/`, no `src/db/`, no `src/index.js`, no `src/rpc/registry.js`, no Cloudflare bindings or workflows. Staff auth phone identity is not a Unified Party identity; never net accounts or merge people by phone. Public `login` stays 503, protected business RPCs 501. Remote staging remains gated by M03 SQL owner, backups, migration-count review, first Administrator provisioning and RBAC.
