# M09 Reporting Read-Contract Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-pinned drift-checkable report endpoint, permission and direct-read manifest while M03/M04/M05–M08 continue independently.

**Architecture:** A single source-only audit module scans frozen GAS reporting files; a checked-in JSON artifact records lexical read and permission contracts. Node tests pressure-test source mutation and snapshot drift; no server or database is contacted.

**Tech Stack:** Node.js ESM, node:test, frozen source manifest, JSON.

**Spec:** `docs/superpowers/specs/2026-11-15-m09-report-contract-inventory-design.md`

## Task 1 — Write behavior tests
- [x] Create `tests/m09-report-inventory.test.mjs` with assertions on original endpoint coverage, read groups, permission labels and deterministic output.
- [x] Mutation test removed permission and missing endpoint; new group reference changes manifest, comments do not; stale JSON diff fails.
- [x] Run RED against missing audit implementation and record expected failing result.

## Task 2 — Minimal scanner and CLI
- [x] Create `scripts/audit-m09-reports.mjs` pure `auditM09ReportContracts({sources,sourceCommit})`.
- [x] Parse top-level declarations, strip comments safely, preserve literal `getAllRows_`/`activeRows_` arguments, detect strict permission gate and helper dependencies.
- [x] Add `--check` compare and explicit `--write` generator (no D1/network).
- [x] Generate `docs/baseline/m09-report-contract-inventory.json`, rerun GREEN tests.

## Task 3 — Release checks and PR
- [x] Run all `npm test`, `npm run verify:source`, `npm run build:frontend`, `node scripts/audit-m09-reports.mjs --check`, `node --check`, `git diff --check`.
- [x] Fetch current `origin/main` and rebase/fast-forward if needed; rerun affected checks.
- [ ] Publish a narrow independent M09 QA PR; inspect GitHub CI; leave pending owner review/merge.

## Files / interfaces
- New: scanner, tests, JSON manifest, design and plan only.
- No changed production code, SQL, migrations, RPC, source files, Party, cashier, bank or sales/stock workflows.