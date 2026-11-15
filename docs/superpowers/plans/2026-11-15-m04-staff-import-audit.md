# M04 Offline Staff/Role Import Preflight — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` or `superpowers:subagent-driven-development`; use RED→GREEN TDD and `superpowers:verification-before-completion`.

**Goal:** Detect review-blocking structural issues in pinned legacy staff and role snapshots while preventing sensitive information from escaping and without touching D1.

**Architecture:** Pure JS `src/auth/staff-import-audit.js` accepts two complete server/export-loaded arrays, performs source-verified structural checks and emits only fixed, anonymized issue codes and counts. No dependency on pending M04 helper PRs or M03 D1 code.

**Tech Stack:** ESM, Node `node:test`, synthetic SHA-256/UUID fixtures, immutable `legacy/source/Config.gs` and source behavior.

**Spec:** `docs/superpowers/specs/2026-11-15-m04-staff-import-audit-design.md`

## Scope and ownership
- **Create only four files:** this plan, spec, `src/auth/staff-import-audit.js`, and `tests/m04-staff-import-audit.test.mjs`.
- No commits to original Mohim_ERP, secrets, actual staff snapshots, D1 schema/import, shared kernel, RPC, frontend, Cloudflare config or other auth helper branches.
- This audit excludes phone collision/permission semantic checks; those remain independently reviewed in PR #39 and PR #30.
- Session rows/bearer tokens excluded; never authorize based solely on a passing preflight.

## Task 1 — source-parity offline audit
- [ ] Create a failing Node test that reads exact USERS/ROLES columns in pinned Config.gs and exercises one synthetic valid roster.
- [ ] Run `node --test tests/m04-staff-import-audit.test.mjs` and observe missing implementation RED.
- [ ] Add tests for duplicate source IDs, duplicate/casefold custom roles, missing/inactive roles, last administrator absence, malformed hash/salt, status/type issues, corrupted JSON, accessor/proxy/sparse rows and anonymized output. Verify no dynamic error messages/secret values.
- [ ] Implement one pure `auditLegacyStaffImport(users,roles)` returning deterministic summary only; fail closed on invalid snapshot and never consume inherited or accessor secrets.
- [ ] Run new tests GREEN; `npm test`, `npm run verify:source`, `npm run build:frontend`, `node --check`, and diff/path verification.
- [ ] Commit four files, push isolated branch, create draft PR with source SHA, file ownership, tests, preflight-only boundary and owner review/CI/Preview gates.

## Acceptance boundary
**No live login or import.** M04 D1 user/role/session/throttle storage, last-admin SQL CAS, password KDF upgrade, credential authorization, token revocation and real Worker/D1 tests remain blocked. `PARALLEL-MODULE-READY=false`.
