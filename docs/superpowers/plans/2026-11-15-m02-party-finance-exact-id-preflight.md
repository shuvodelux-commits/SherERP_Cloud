# M02-P exact Finance Person ID preflight — Superpowers implementation plan

> Execute source inspection → test-first RED → smallest GREEN → refactor if necessary → exact-head GitHub CI. Work only in the dedicated GitHub branch and PR, no routine local PC use.

**Goal:** Prevent silent Finance Person identity aliasing by whitespace normalization when preparing offline gross Party financial checkpoints.
**Design:** `docs/superpowers/specs/2026-11-15-m02-party-finance-exact-id-design.md`. **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` frozen.
**Owns:** `src/party/gross-balance-preflight.js`, `tests/m02-party-finance-exact-id-preflight.test.mjs` and these two docs. Existing Party import planner/readback D1 guard workstream and current concurrent PRs retain ownership of their own files.

## Task 1 — RED
- [ ] Confirm `AGENTS.md`, M02-P guidance, ADR-007, original finance ID contract, current gross-balance preflight and regression fixtures.
- [ ] Commit new Node tests **before** production code: padded transaction vs unpadded-only master must block, distinct literal IDs with distinct roles must preserve correct balances, same reviewed Party must not confer alternate source-ID roles, exact padded literal matches, and no input mutation.
- [ ] Open draft PR and prove expected failing assertions on GitHub Foundation exact RED SHA.

## Task 2 — GREEN
- [ ] Replace the two Finance `Person ID` `.trim()` normalizations with exact source ID, retain a `.trim()`-only *blank ID guard*, and preserve all other finance signs, minor-unit arithmetic, deleted row behavior and issue report shape.
- [ ] Verify targeted RED tests GREEN. Verify entire Node suite, frozen 84-source audit, original frontend build. No unrelated refactoring.

## Task 3 — integrated PR proof
- [ ] Run M02 identity local Workerd/D1, M02 synthetic Party import rehearsal, M03/M04 Workerd/D1, browser and Cloudflare PR-safety checks on final head; distinguish these existing suites from actual finance posting tests.
- [ ] Recompare branch with fresh main and sync only disjoint concurrent code. Require exactly four scoped paths in PR diff and 0 behind before review readiness.
- [ ] Document RED + GREEN CI run IDs, tests, source/financial safety, rollback and blocked real import/cutover. Mark ready only after exact-head all-green; do not merge the new PR without owner request.

**Release gate:** source-only offline review, zero cash/bank movement or D1 writes, no auto-merged Party identities, no approved production migration.
