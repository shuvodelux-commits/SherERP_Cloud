# M02-safe Offline Import Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce one-to-one provenance and explicitly reviewed Party identities in local catalog/Party import plans.

**Architecture:** Standalone pure verifier and CLI around existing read-only planners. Fails closed on identity/quarantine/position/accounting contamination; emits only sanitized counts.

**Tech Stack:** Node.js >=22 ESM, node:test, existing M02 catalog and M02-P Party planners.

**Spec:** `docs/superpowers/specs/2026-11-15-m02-offline-reconciliation-design.md`

## Global Constraints
- No modifications to original source, planners, schema, D1, backend RPC, or deployed Worker.
- Do not print raw exported source identities or filenames on failure.
- Explicit human proof only for merged Party IDs. No netting or financial account conversion.

## Task 1 — Tests of reconciliation failures
- [x] Write `tests/m02-offline-reconciliation.test.mjs` using existing synthetic catalog/Party fixtures.
- [x] Confirm unmodified source yields correct counts with no names/phone.
- [x] Confirm distinct default identities and explicitly reviewed merge.
- [x] Mutation tests: quarantine, duplicate IDs, lost legacy link, changed sheet position, altered catalog ID, unreviewed merge, dropped catalog row.
- [x] Confirm CLI's redacted error and safe output.
- [x] Run against stub and observe six tests fail for missing validation.

## Task 2 — Minimal verifier and CLI
- [x] Implement `scripts/check-m02-offline.mjs` exposing pure `verifyM02OfflineReconciliation`, loading only local JSON under CLI guard.
- [x] Verify source/plan catalog row ID and position; source/plan Party membership, role and review evidence; reject quarantine and financial outputs.
- [x] Run `node --test tests/m02-offline-reconciliation.test.mjs` and see six tests pass.

## Task 3 — Verification and PR
- [x] Run `npm test`, `npm run verify:source`, `npm run build:frontend`, offline CLI with both real synthetic fixtures, and negative mutation CLI.
- [x] Run `node --check` new scripts/tests and `git diff --check`.
- [x] Review current `origin/main` for new changes to M02 safe paths; rebase/fast-forward if needed and retest.
- [ ] Create independent PR, do not merge; report GitHub CI results, exact impacts, and remaining M02-P/real D1 blockers.

## Files and interfaces
- Create only `scripts/check-m02-offline.mjs`, `tests/m02-offline-reconciliation.test.mjs`, this plan and the design doc.
- No RPC, SQL, cash/bank, stock, account or Worker code changes.