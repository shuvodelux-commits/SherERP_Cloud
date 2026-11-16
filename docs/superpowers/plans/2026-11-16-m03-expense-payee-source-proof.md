# M03 Expense Payee Source Proof — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development, test-driven-development and verification-before-completion; each step uses checkboxes. Follow owner-mandated GitHub-only RED→GREEN→CI→review.

**Goal:** Preserve original Expense Payee source IDs, tombstone metadata, physical source position and UI lists as a deterministic source-only migration prerequisite, while proving no Party auto-merges in real local D1.

**Architecture:** One internal pure module `src/modules/expense-payee-source-projection.js` consumes an already exported full source snapshot; no database access or public RPC. It builds exact source-shaped cloned rows, the source Settings nondeleted list, the active dropdown and the management rows. An independent Workerd test uses the already merged M02 Party D1 schema to demonstrate exact source-ID link isolation; it does not simulate a missing payee D1 master table.

**Tech Stack:** Node 22 ESM `node:test`, Wrangler 4.161.0 isolated Workerd/D1 CI, existing M02 Party schema.

**Spec:** `docs/superpowers/specs/2026-11-16-m03-expense-payee-source-proof-design.md`.

## Global constraints

- Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, original ten `EXPENSE_PAYEES` columns and original `DeleteEngine.gs::isDeleted_` semantics.
- No M02 schema/import owner files modified, no public endpoint, no original JS/CSS/HTML, no remote D1, no identity by matching name/phone, no Payee financial liability, no new runtime dependency.
- Source output is explicitly an *offline source snapshot projection*, not an authenticated real D1 payee read.
- Every production change gets test-first RED evidence, minimal GREEN, full Node and local Workerd D1 checks, draft PR and owner-only merge.

## 14-sentence overview

1. The previous PR #358 merged original Expense Categories D1 read parity.
2. The next Expense Payees source master has ten original columns, not five.
3. Four of these are soft-deletion and audit metadata that must remain intact.
4. The original database helper returns every physical row and its original row number.
5. Source `activeRows_` hides deleted records but keeps inactive ones.
6. The Expense dropdown additionally hides inactive payees.
7. The Payee management list displays inactive entries and normalizes their status label.
8. Two different payees may legitimately have identical names or phone numbers.
9. Each historical Payee ID remains the authoritative source identifier.
10. The existing M02 Party D1 identity schema can link an exact EXPENSE_PAYEES source ID.
11. It cannot justify a cross-source merge based on matching display text or phone.
12. This increment builds deterministic validated source projections before any payee D1 table or import exists.
13. Node tests exercise preservation, rejection, privacy and copy safety, while isolated real D1 checks test exact Party links and no writes.
14. Full D1 payee storage, expense.view authorization, ERP RPC activation and live cutover remain deliberately out of scope.

## Review focus

1. A deleted source row with `Is Deleted:'TRUE'` remains in `allRows` with reason and actor but in no display list; node test.
2. An inactive but nondeleted source row remains in `settingsPayees` and `managementPayees` but not `activeUiPayees`; node test.
3. Duplicate name/phone rows never auto-merge; distinct ID and physical positions preserved; Node+real D1.
4. A sparse, accessor, symbol, unexpected status/phone or unsafe row index fails before any returned partial result or leaked source value; node test.
5. Even after snapshot projection, exact Party resolution requires `source_group='EXPENSE_PAYEES'` and matching source ID; no implicit Party row or link writes; real D1 test.

---

### Task 1 — RED original snapshot and display behavior

**Files**
- Create `tests/m03-expense-payee-source-projection.test.mjs`
- Create `tests/integration/m03-expense-payee-party-proof-workerd.spec.mjs`

**Interfaces**
- `prepareExpensePayeeSnapshot(sourceRows)` → full cloned original source rows array.
- `projectExpensePayeeViews(sourceRows)` → `{allRows,settingsPayees,activeUiPayees,managementPayees}`.
- Existing `resolveLegacyPartyId({DB},'EXPENSE_PAYEES',payeeId)` for real local D1 identity isolation only.

- [ ] Write focused test using all ten frozen source keys, source code contract asserts, complete snapshots, duplicate labels, tombstones/inactive, original sort, missing/extra/accessor input, read-only clones and 1000 row cap.
- [ ] Write real isolated M02 Party D1 link test without creating a nonexistent payee master table.
- [ ] Commit tests before module; open draft PR; run Foundation `npm test` and observe RED missing-module error or expected contract assertion. Record exact SHA/run/job.

### Task 2 — GREEN smallest source-safe projection

**Files**
- Create `src/modules/expense-payee-source-projection.js`.

**Interfaces**
- Export above two functions. Use exact own-data field descriptors, strict source index and identifiers, no normalization or unintended coercions. UI records sorted by `String(name).localeCompare`; never expose deleted audit metadata outside full Settings source rows.

- [ ] Implement one validation pass with strict row clone.
- [ ] Implement deletion filtering according to `isDeleted_`, and original two view projections using clones.
- [ ] Commit minimum implementation, run full Foundation CI `npm test`, fix any observed regression before claiming success.

### Task 3 — Real D1 source ID proof and review gate

**Files**
- Modify `.github/workflows/m03-d1-workerd.yml` to append `node --test tests/integration/m03-expense-payee-party-proof-workerd.spec.mjs` after existing M03 tests.

- [ ] Run real Workerd/D1 Party exact-link test and verify no schema or business-data side effect.
- [ ] Confirm original source SHA, unchanged original browser build, auth/preview safety and exact-head PR checks.
- [ ] Review source/table impact and latest main mergeability; report separate M02 Payee master D1 storage/import and M04 expense.view dependency explicitly.
- [ ] Leave draft PR and owner review/merge; **M03 is not complete**.
