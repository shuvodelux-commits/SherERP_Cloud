# M09 Settings and Invoice Design Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task by task, with test-first RED → GREEN and real run evidence.

**Goal:** Add drift-detectable parity contracts for Settings and Invoice Design without touching runtime modules.
**Architecture:** One source-only Node ESM scanner with fixed public RPC names; a JSON baseline from immutable original GAS and HTML; targeted Node tests and GitHub Actions.
**Tech Stack:** Node 22+ ESM, node:test, no new dependencies.
**Spec:** `docs/superpowers/specs/2026-11-15-m09-settings-invoice-contract-design.md`

## Global constraints
GitHub-only branch/PR; no local PC work; no edits to frozen original source, Worker, D1, auth, shared financial files, UI, deployment or secrets. Never claim source inventory proves behavior or security.

## Review focus
- Commented-out permission and RPC strings must not masquerade as a live contract (negative tests).
- Unexpected function rename must reject, not silently omit an endpoint (negative test).
- A changed editable key, logo limit or MIME should change the manifest (mutation tests).
- An unexpected UI call must be inventoried, not ignored (drift test).
- Invalid source and stale checked-in JSON must fail closed (negative tests).

## Task 1 — Write tests (RED)
**Files:** Create `tests/m09-settings-invoice-contract.test.mjs`.
**Interface needed:** `auditM09SettingsInvoiceContracts({sources,sourceCommit})` and `assertM09SettingsInvoiceSnapshot(current,snapshot)`.
- [ ] Test five permissions, 30 editable/5 numeric/3 boolean keys, 1.5 MiB/four logo MIME types, active bank source, Settings and Invoice Design HTML RPC names, and invoice receipt/footer keys.
- [ ] Test deletion of public endpoint/permission, commented source, source and manifest drift, malformed SHA and missing file.
- [ ] Commit tests before scanner; create draft PR so no-secrets GitHub Actions runs.
- [ ] Verify expected RED in CI due to absent scanner (not a passing or falsely-green test).

## Task 2 — Minimal auditor (GREEN)
**Files:** Create `scripts/audit-m09-settings-invoice.mjs`, `docs/baseline/m09-settings-invoice-contract-inventory.json`.
- [ ] Implement direct lexical extraction of frozen source declaration arrays, permission gated top-level RPCs, backend direct group reads, UI `serverCall` names/DOM IDs, invoice render setting reads, and logo size.
- [ ] Explicit `--check` compare and `--write` generator; no evaluation of original scripts.
- [ ] Verify GitHub Actions `npm test` and `npm run verify:source` GREEN at exact PR head; run `npm run build:frontend` through the same CI workflow.

## Task 3 — Review and handoff
- [ ] Review exact PR diff, inventory, no runtime/schema/financial writes, changed files, and resulting GitHub Actions status.
- [ ] Link source SHA, RED/GREEN evidence, tests and unresolved M03/M04/print gates in PR body.
- [ ] Leave PR for owner review; do not auto-merge or deploy financial functionality.

**RPC before/after:** no changes. **Tables:** none. **Cash/bank/Party/stock:** no effects. **Recovery:** revert isolated source-only files.
