# M03/M04 Role Settings Edit SQL Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This work follows Superpowers RED → GREEN and GitHub-only PR review.

**Goal:** Allow a current M04 custom-role `settings.edit` grant to authorize existing shell Settings CAS atomically, without weakening Administrator behavior or security.

**Architecture:** Expand one existing bound SQLite `UPDATE` to match a current M04 role row and strict JSON edit grant inside the same statement. Keep all external and internal function signatures unchanged; use actual local D1 and M04 fixture, no deployable migration.

**Tech Stack:** JavaScript ESM, Node built-in test runner / `node:sqlite`, SQLite JSON functions, Cloudflare Workerd + Wrangler isolated D1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-15-m03-m04-role-settings-edit-design.md`.

## Global Constraints

- Respect current `AGENTS.md`, M03 `src/db` owner and `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- No local PC, unapproved production/staging D1 migration, public RPC, frontend redesign, other module edits, or permission grants inferred from `allowed_modules`.
- No independent preflight auth SELECT; role verification must share the same D1 UPDATE as previous-value CAS.
- Keep single-business isolated D1 assumption, no shared-tenant claim.

## Task — Narrow custom-role authorization in source-shaped Settings update

- [ ] **Inspect existing files:** `legacy/source/Auth.gs` (`requirePermission_`, `getUserPermissions_`, `hasPermission_`), `legacy/source/Settings.gs`, current M04 table/triggers and M03 CAS tests.
- [ ] **Record RED:** Change the role-positive expectation in `tests/m03-m04-settings-auth.test.mjs` and existing Workerd integration to expect a valid active role with JSON `{"settings":{"edit":true}}` can update an existing row. Add role-revoked, inactive, missing, malformed JSON / wrong JSON primitive and expired user cases. Commit tests before changing `src/db/m04-settings-update.js`; capture GitHub Actions Node failure for the expected refused role.
- [ ] **GREEN:** Modify the one SQL UPDATE only: LEFT JOIN role by name, active role+version match, guarded `json_valid/json_type` `settings.edit` is literal boolean true. Keep current input validation and update result policy unchanged.
- [ ] **Verify:** Confirm role-positive test and all negative cases pass via GitHub CI. Verify actual workerd/D1 suite, real M04 login, source pin, Party tests, Chromium and Cloudflare Preview; identify any failures and fix on this branch.
- [ ] **Document and PR:** Update M03/M04 authorization contract with role limits and RED/GREEN links, recheck latest `main` for conflicts, mark PR ready only when all checks pass. Do not merge or deploy; `PARALLEL-MODULE-READY=false`.

