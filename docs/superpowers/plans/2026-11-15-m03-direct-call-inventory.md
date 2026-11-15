# M03 Direct Source-Call Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans; follow TDD and verification-before-completion.

**Goal:** Produce a deterministic, read-only inventory of original Apps Script database helper usage so independent M03/M04/M05 module agents can receive non-overlapping source ownership.

**Architecture:** Scan the pinned `legacy/source/*.gs` text for explicit Database.gs helper calls and GAS runtime dependencies, summarize only filenames and counts. Do not parse or execute GAS, expose secrets or claim that a lexical scan is a complete transitive dependency graph. Persist a machine-generated baseline for later review and drift detection.

**Tech Stack:** Node >=22 native ESM, `node:test`, no new packages.

**Spec:** Owner-approved `docs/WORKSTREAMS.md` M03 deliverable, `docs/MIGRATION_PLAN.md`, `AGENTS.md`, and approved M03 follow-up after PR #18.

## Global Constraints
- Original `legacy/source` immutable.
- No public Worker RPC, D1 bindings, cloud writes, schema migrations, auth bypass, product/UI redesign.
- Direct lexical matches are leads for migration review, not proof of full async call graph.
- Single owner of shared DB/repository/migrations/posting kernel; finance and Party boundaries untouched.

## Review Focus
- Comments and function declarations must not inflate call counts.
- Count caller locations in .gs files without leaking line text, credentials or user data.
- Report sorting must be deterministic across platforms.
- Missing or modified source inventory must fail the --check gate.
- Direct GAS calls and helper writes must remain visible separately.

## Task 1: Detection and TDD
**Files:** `tests/m03-direct-call-inventory.test.mjs`, `scripts/audit-m03-callers.mjs`
**Interface:** `summarizeLegacyCallers(files: Record<string,string>): Inventory`

- [ ] Write tests that expect helper read/write counts, direct getSheet_/getRange detection, GAS runtime APIs, and ignoring comments/definitions.
- [ ] Run `node --test tests/m03-direct-call-inventory.test.mjs`: RED missing module.
- [ ] Implement minimum deterministic inventory builder, conservative lexical matching.
- [ ] Re-run targeted tests: GREEN.
- [ ] Commit after tests.

## Task 2: CLI and pinned snapshot
**Files:** `scripts/audit-m03-callers.mjs`, `docs/baseline/m03-direct-call-inventory.json`, `tests/m03-direct-call-inventory.test.mjs`
**Interface:** CLI default emits JSON; `--check` compares against frozen baseline, exits nonzero for drift.

- [ ] Write failing CLI acceptance test (no generated baseline).
- [ ] Generate baseline from pinned .gs files, implement `--check`.
- [ ] Run targeted tests and source verification.
- [ ] Commit after tests.

## Task 3: Parallel readiness handoff
**Files:** `docs/M03_PARALLEL_READINESS.md`, `docs/superpowers/plans/2026-11-15-m03-direct-call-inventory.md`
- [ ] Define now-allowed isolated parallel work (M02 importer/read parity, M03 caller graph, M04 auth contract design, M01 UI test parity); no parallel writes.
- [ ] Set strict gating for full module coding: M03 async + D1 completed, M04 auth/RBAC accepted, M02-P reviewed Party/financial mapping, one DB and posting kernel owner.
- [ ] Verify `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m03-callers.mjs --check`, `git diff --check`.
- [ ] Open a separate PR to main; no merge without user request / review.
