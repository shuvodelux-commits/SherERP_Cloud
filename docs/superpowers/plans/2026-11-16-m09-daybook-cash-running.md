# M09 Day Book running cash balance — Superpowers implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development and superpowers:verification-before-completion. Follow the saved RED test-first GitHub Actions → minimal GREEN implementation → rerun workflow and owner review.

**Goal:** Preserve the original Day Book cash drawer running balance from Cash Book movement timestamps rather than incorrectly summing UI cash fields.

**Architecture:** One pure internal projector receives complete pre-authorized normalized Day Book rows and Cash Book rows; it builds ephemeral source indexes, sorts movements and applies signed deltas in source order while returning copied Day Book rows. No D1 or RPC wiring.

**Tech Stack:** Node 22 ES modules, node:test and node:vm frozen GAS source oracle; GitHub Actions. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-16-m09-daybook-cash-running-design.md`

## Global constraints
- Pin exact original source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; never edit GAS or original HTML.
- Keep all cash/stock/finance writes and D1 schemas owned by their M02/M05/M07/M08 workstreams.
- Public RPC remains fail-closed; previews remain DB-free. No production/backfill/financial migration.
- Strictly accept trusted, complete normalized source rows. Do not fall back to Day Book derived cash totals.

### Task 1 — source oracle, plan and RED
**Files:** spec, this plan, `tests/m09-daybook-running-cash.test.mjs`.
- [ ] Commit source-based VM tests, positive ties/corrections/date-only and negative isolation/validation scenarios BEFORE implementation.
- [ ] Open draft PR for RED branch to trigger Foundation source checks.
- [ ] Capture exact failed GitHub Actions run/test count and verify failure is missing export, not malformed oracle.

### Task 2 — minimal GREEN
**File:** `src/modules/daybook-running-cash.js`.
- [ ] Read and validate both complete arrays. Clone source rows. Sort by source timestamp; compute cash source reference index after sorting.
- [ ] Source-equivalent cash movement timestamp attach within 30 seconds; old date-only attach; sort Cash Book movements by effective timestamp/source index.
- [ ] Apply all movements in reference-aware order, including same-second tie handling; round money after each movement; fill only missing time values. Do not mutate inputs or misstate open drawer.
- [ ] Observe GitHub full Node/source build and affected existing Workerd, Browser smoke, preview safety check. Fix deviations without claiming success early.

### Task 3 — draft PR / review
- [ ] List exactly four added M09 files and source/RPC/SQL/financial migration impact.
- [ ] Record RED/GREEN SHA, exact test counts, links, all CI statuses and limits of test evidence.
- [ ] Compare against newest main; check mergeable state and notify owner (do not merge automatically).
- [ ] Follow-up work remains actual authorized source-backed D1 transaction feed, Cash Session/Party reconciliation and full mobile/print parity.
