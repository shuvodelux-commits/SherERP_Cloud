# M09 Purchase Return Report Lineage Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, verifying test-first RED and exact-head GREEN.

**Goal:** Detect imported Purchase Return parent/child Purchase ID mismatches and source-identity integrity violations without calculating financial figures or enabling reports.

**Architecture:** A new independent M09, pure ESM read-only preflight over complete frozen-source-shaped arrays. Output is fixed redacted blocker codes and always `ready:false`.

**Tech Stack:** Node `node:test` + ESM; GitHub Actions mandatory source, Node and local Workerd/D1 suites; no new packages.

**Spec:** `docs/superpowers/specs/2026-11-17-m09-purchase-return-report-lineage-audit-design.md`

## Global Constraints
- Base `main@1f068fc3c30c625446c560364fb872ae68cb8bc1`, branch `m09/purchase-return-report-lineage-audit-20261117`, issue #431.
- Exclusive M09 ownership of four new files. No `src/db`, `migrations`, `src/rpc`, `src/index.js`, Worker binding, common posting or original UI modifications.
- Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` remains read-only. `reports.view` and live D1 activation are NOT implemented by this task.
- Parent #459 merged into main; authenticated import and source reconciliation are separate upstream gates.

## Review Focus
- Original helper associates by Return ID while Purchase Report sums by child Purchase ID.
- Deleted parents/children, duplicate active Return IDs, missing/deleted original purchases.
- Active header with no children should fail closed rather than appear to be a zero-return record.
- Reject getter/prototype/sparse-array inputs without leaking source IDs or data.
- Every output including pristine synthetic input returns `ready:false`.

## Task 1: Write failing source-lineage tests (RED)
**File:** Add `tests/m09-purchase-return-report-lineage-audit.test.mjs`.
- [ ] Valid multi-purchase/multi-return and non-mutating always-not-ready results.
- [ ] Mismatched child Purchase ID; orphan, missing/deleted purchase, duplicate active Return/Purchase IDs, empty active header.
- [ ] Frozen case-insensitive deletion, deleted headers/children, source ID type.
- [ ] Dense arrays / own-data getter safety and redaction.
- [ ] Commit tests separately before implementation; inspect **actual GitHub Actions RED** for expected missing production module only.

## Task 2: Implement minimal pure GREEN
**File:** Add `src/modules/m09-purchase-return-report-lineage-audit.js`.
- [ ] Source-compatible active/deleted and Return/Purchase ID checks.
- [ ] Return only stable fixed issue codes + always false `ready`.
- [ ] No D1, financial calculation, source repair, public endpoint or new library.
- [ ] Verify focused test, full `npm test`, `npm run verify:source` and exact current head full mandatory GitHub CI. Source-only validator: **no claim of real D1 coverage specific to this function**.

## Task 3: Review and integration
- [ ] PR to `main` with exact owned path list, source SHA, RED/GREEN links, dependency and merge order.
- [ ] Recompare against newest main; resolve any overlap via M03 coordination instead of forcing.
- [ ] Merge only when all required exact-head CI and owner review pass; recheck main file presence, update issue.
