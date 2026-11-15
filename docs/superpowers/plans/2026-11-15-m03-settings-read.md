# M03 Settings read compatibility — TDD implementation plan

> Source design: `docs/superpowers/specs/2026-11-15-m03-settings-read-design.md`. Use isolated worktree, RED/GREEN, and verification-before-completion.

## Task 1 — source and failing tests
- [x] Confirmed original `Database.gs:getSettingsMap_`, `UI.gs:getAppShellData`, `Utils.gs:isSettingEnabled_` semantics and M02 Settings D1 columns.
- [x] Wrote 9 local Workerd/D1 cases and 2 Node unit cases for Settings map, safe shell, fallbacks, Unicode, text, fresh reads, malicious keys, bounded reads and route denial.
- [x] Observed expected RED missing settings-read.js before implementation.

## Task 2 — minimal implementation
- [x] Implemented `src/db/settings-read.js`, static parameterized D1 reads, bounded record validation and no module cache.
- [x] Created 404-only local test Worker with fake UUID, imported suite in existing M03 integration entry.
- [x] Documented internal-only scope, source parity, private map handling and M04 auth gates.

## Task 3 — review and release
- [x] Fresh checks: 259/259 Node, 91/91 M03 Workerd/D1, 9/9 M02 Party, 6/6 Party plan, 84 pinned source files, frontend build, 47-file caller audit, syntax and diff checks.
- [ ] Push focused PR, require green GitHub workflows and exact-head successful DB-free Cloudflare Preview; verify /api/health then squash merge.
