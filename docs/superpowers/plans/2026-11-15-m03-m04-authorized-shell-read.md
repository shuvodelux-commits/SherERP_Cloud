# M03/M04 Authorized Shell Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This work follows Superpowers RED → GREEN with a dedicated GitHub branch and scoped PR.

**Goal:** Read only the safe shell Settings keys from actual D1 when the current M04 session owns `settings.view` authority.

**Architecture:** A new tiny read-only adapter performs authentication and the safe two-key Settings projection in **one D1 SELECT**. It does not modify existing M03 reads, M04 role mutations, actual migrations or deployed RPC.

**Tech Stack:** ESM JavaScript, SQLite (`node:sqlite`), Cloudflare Workerd+local D1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-15-m03-m04-authorized-shell-read-design.md`.

## Constraints
- Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, current `AGENTS.md`, original UI, KISS.
- Use unchanged M02 D1 Settings schema and unchanged test-only M04 auth migration; no new deployable migrations or public routes.
- Do not treat `settings.edit` as `settings.view` or `allowed_modules` as authorization.
- Test-only isolated single-business D1; no shared-tenant assumption.

## Single independently reviewed task
- [ ] Inspect frozen `Auth.gs:hasPermission_`, `Settings.gs:getSettingsBootstrap`, current `settings-read.js`, M04 D1 fixture and role session epoch tests.
- [ ] Commit this design and plan **before implementation**.
- [ ] **RED:** commit Node SQLite contract test `tests/m03-m04-settings-view.test.mjs` and actual D1 Workerd test `tests/integration/m03-m04-settings-view-workerd.spec.mjs` plus 404-only test fixture configuration and one import to M03 suite; verify expected missing adapter failure in GitHub Actions.
- [ ] **GREEN:** implement `src/db/m04-settings-view.js`; strictly validate token/time, hash bearer bytes, one parameterized SELECT filtering to two public shell keys and checking active session/role grant inside the statement. Verify both test suites and hardening cases.
- [ ] Verify all PR GitHub checks including Node, real local Workerd/D1, source pinned 84 files, M04 auth, staging policy, Party, Chromium and Workers Preview. Document exact evidence and deployment barriers.
- [ ] Recheck branch vs latest `main`, mark PR ready for owner review; **do not merge or deploy**.
