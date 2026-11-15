# Superpowers TDD plan — M03 ID-counter floor

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Branch:** `feat/m03-id-counter-floor-20261115`, new from current `main`.
**Design:** `docs/superpowers/specs/2026-11-15-m03-id-counter-floor-design.md`.

1. Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, frozen `Utils.gs::generateId_` and `Config.gs::ID_PREFIX`. Review M03 writer/PR ownership: no shared `src/db` edits, no live allocator.
2. **RED:** first create `tests/m03-source-id-counter-floor.test.mjs`. Extract and execute original frozen `generateId_` body via Node VM, provide fake CONFIG, PropertiesService, getSheet_ physical ID column; assert canonical high-water and next preview across two source ID families and source counters. Add fail-closed negative cases, immutability and no-live-counter assertion. Commit test before implementation; record the expected Node import failure from GitHub Foundation.
3. **GREEN:** add only `src/modules/source-id-counter-floor.js` with the pure `planSourceIdCounterFloor` function. Match original behavior for valid snapshots, reject malformed source IDs/counters instead of guessing.
4. Review exact-head GitHub Foundation 100% Node tests, 84-file source pin, 36-include original UI assembly; M01 Chromium, M03+M04 actual local Workerd/D1, M02 local import/identity, Cloudflare PR-safety. All build/test results are gating; report failed/pending truthfully.
5. Create/update narrow PR with original source pin, RED/GREEN logs, file/RPC/table impact, no production D1 changes, explicit non-authoritative preview limitation and rollback; compare latest main before merge. Leave newly-created PR for user-reviewed integration.

**Files:** two new Superpowers docs, one new Node test and one new internal module only. **RPC/tables:** none. **Source bytes:** original JS source used by test-only Node VM; no copied GAS runtime.
