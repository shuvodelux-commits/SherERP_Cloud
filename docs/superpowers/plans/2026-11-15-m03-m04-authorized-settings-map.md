# M03/M04 Authorized Full Settings Map — Superpowers Implementation Plan

> **Superpowers TDD:** Plan → write failing tests → observe RED in GitHub CI → minimal GREEN → full verification → scoped PR. Never merge/deploy without owner review.

**Goal:** Add a source-faithful, current-session-authorized `getSettingsMap_` to the already reviewed internal M03/M04 Settings view adapter. Do not activate the public Settings page.

**Architecture:** Share existing M04 `WITH authorized` CTE between the current safe-shell SELECT and a second fixed, full Settings SELECT. Both read actual M02 Settings rows only when authority and values are checked in one statement. The query must include a sentinel for authorized empty map and a hard 257-row cap.

**Files:** `src/db/m04-settings-view.js`, `tests/m03-m04-settings-view.test.mjs`, `tests/integration/m03-m04-settings-view-workerd.spec.mjs`, `docs/M03_M04_AUTHORIZED_SHELL_VIEW.md`, this plan and companion spec. No test harness import or Wrangler changes.

**Task 1 — RED**
- Inspect `AGENTS.md`, `docs/MIGRATION_PLAN.md`, ADR-007, pinned `Settings.gs:getSettingsBootstrap`/`Database.gs:getSettingsMap_`, existing M02 Settings DDL and M04 role/schema/reader.
- Commit spec and plan before tests.
- Extend existing Node SQLite tests: full map as-is and safe shell unchanged, role permission boundaries, empty/256/257 row caps, unsafe/duplicate/malformed D1, invalid requests, stale role, explicit one-statement SELECT and no `UPDATE`.
- Extend existing local real Workerd tests: actual D1 full Settings rows and confidential values only for current `settings.view`; edit-only denied; 257 row refusal with cleanup, and 404-only Worker.
- Commit test-first to GitHub and open draft PR; verify the **missing `getSettingsMap_` method** causes meaningful RED (not unrelated CI failure).

**Task 2 — GREEN**
- Share pre-existing static AUTH CTE, preserve shell query results/scope, add only the fixed map query, strict row decoder and sibling method. No new exports or business schema.
- No JS auth preflight followed by unguarded map read; no extra D1 query or exposure via production `src/index.js`/`src/rpc/**`.
- Repair only failures exposed by tests; rerun Node and actual Workerd via PR CI, verify original GAS checksum, frontend build, M04 login, Party and Chromium.

**Task 3 — Review**
- Document confidentiality boundary: `settings.view` original source intentionally permits confidential Settings values, so this raw map stays internal until reviewed secure RPC.
- Record RED/GREEN commit/job evidence, exact test counts and file/SQL impact, risks/rollback, and final-head status.
- Recheck main/mergeability; mark ready only on all checks green. Keep PR unmerged and `PARALLEL-MODULE-READY=false`.
