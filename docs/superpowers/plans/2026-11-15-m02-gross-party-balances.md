# M02-P Gross Party Financial Checkpoint Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic, offline gross account checkpoints with separate current/historical opening evidence, with strict source ID attribution and no financial posting.

**Architecture:** New pure preflight function consumes existing `planPartyImport` identity proposal plus source-shaped master/finance rows. Return sorted, integer-minor-unit, role-specific checkpoints and explicit quarantine blockers.

**Stack:** Node.js ESM, node:test; original pinned GAS code as reference only.

**Spec:** `docs/superpowers/specs/2026-11-15-m02-gross-party-balances-design.md`

## Task 1: Baseline tests
- [x] Add `tests/m02-gross-party-balances.test.mjs` with seven roles represented and same-party Customer/Supplier/Vendor/Lender balances unnetted.
- [x] Add finance sign directions, opening-versus-current separation, negative finance credits, deleted rows, orphan/missing Person ID and invalid amounts.
- [x] Run RED against an initially missing/stubbed pure module.

## Task 2: Implement minimal pure preflight
- [x] Create `src/party/gross-balance-preflight.js` and mirror exact source transaction-type directions, signed openings and vendor two-way positions.
- [x] Strictly parse integer minor units, reject negative vendor source positions and any amount precision ambiguity, quarantine finance provenance/duplicates.
- [x] Maintain PII-free deterministic output, no SQL/Worker changes, and no cross-party/role netting.
- [x] Run targeted GREEN and full source-preserving verification.

## Task 3: GitHub verification and PR
- [x] Fast-forward to latest `origin/main` and rerun `npm test`, `npm run verify:source`, `npm run build:frontend`, JS syntax and diff checks.
- [ ] Publish narrow M02-P preflight PR; verify GitHub checks and report which M02-P/M03/M04 gates still block deployment.

## File ownership
Only new `src/party/gross-balance-preflight.js`, `tests/m02-gross-party-balances.test.mjs`, design and plan. No migrations, `src/db`, M04, `src/rpc`, Worker, legacy source, UI, cash/bank, SQL, posting or live imports.
