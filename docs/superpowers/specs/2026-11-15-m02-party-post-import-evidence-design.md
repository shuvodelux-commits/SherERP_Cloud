# M02-P — Party Import Post-Readback Evidence Gate

**Date:** 2026-11-15. **Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, approved ADR-007. **Prerequisites:** merged #146 (source drift), #154 (source export coverage), #162 (offline validation composition), original `planPartyImport` and `reconcilePartyImportReadback`. The repository's `PARALLEL-MODULE-READY=false` remains.

## Problem

A clean reviewed export is **not** evidence that the planned Party identity, role membership or original legacy link survived even an offline/import rehearsal into D1. Existing `reconcilePartyImportReadback` accepts an explicitly provided plan, but does not verify that plan still corresponds to a complete unchanged **reviewed source export**. An operator could compare current D1 identity rows to a plan built from stale or incomplete inputs or disregard a missing persisted human approval reference.

## Decision and interface

Add `reconcileReviewedPartyImport({reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups,readback})` as a **pure, internal-only, no-I/O** `src/party/import-evidence-gate.js`. The caller must supply trusted offline master snapshots, exact source sheet header metadata, an explicit human-review claim array and a D1-shaped identity readback snapshot. The function does **not** fetch/read D1 itself, authenticate a reviewer, or activate an importer.

1. Run the already reviewed `validatePartyImportCandidate`, which checks both original export schemas and changed-source/identity approval evidence. If `offlineValidationClear!==true`, mark the readback stage `skipped` with **null** readback status/counts; do **not** generate a new plan or inspect the readback. Never treat skipped checks as passed.
2. Only after source validation clears, derive `planPartyImport(candidateRows,approvedGroups)`. This is the original deterministic offline identity plan (exact original source IDs, roles and human review evidence; no name/phone auto-linking).
3. Run `reconcilePartyImportReadback({plan,readback})` against three **explicit** D1-shaped readback collections: `parties`, `party_roles`, `party_legacy_links`. Require **both** `identityRowsMatch===true` and `approvalEvidencePersistent===true`. A retained reviewer name/time without an `approval_ref` does not suffice for a human-verified link. Wrong source legacy ID, changed role/status, missing/extra row, duplicate original ID or modified approval-ref must fail.
4. Return only a **redacted report**, no source/raw readback/plan objects:
`{formatVersion:1,sourceValidationClear,readbackChecked,readbackMatches,approvalEvidencePersistent,offlineEvidenceMatches,counts:{source,readback},issues}`.
For skipped readback, `readbackMatches=null`, `approvalEvidencePersistent=null`, `counts.readback=null`. Issues are deterministic `{stage,scope,code,count}` with fixed stage vocabulary and a fixed allowed scope: original five Party groups, `PLAN`/`VALIDATION`, or one of the three D1 identity tables. Aggregate repeated readback `FIELD_MISMATCH` by table without printing field names. No IDs, names, phones, review refs, account amounts or raw exception text in returned data.
5. All malformed or incomplete D1 snapshots, invalid approvals or unexpected errors throw one fixed `Party import evidence unavailable` error. **Even successful offlineEvidenceMatches is NOT production import/cutover approval**, audit authentication, durable data provenance certification or full ledger reconciliation. The current `0002_party_identity.sql` does not persist `approval_ref`: this must still block reviewed-join reconciliation. Separate Finance/Customer/Supplier/Vendor gross accounts remain governed by the approved M02-P ledger/sign reconciliation work.

## Ownership and acceptance

Exactly four **new** files (spec, Superpowers plan, new test, new pure module). No edits to shared source, Party planner/reconciler, migrations, Workerd/Worker configuration, `src/db`, `src/auth`, `src/rpc`, GAS, UI, ledger, remote D1 or environment. Never access owner's desktop; GitHub-only. No new dependencies; KISS (composition, not new identity engine). Rollback by reverting PR, no data recovery. TDD RED missing module in GitHub Actions before GREEN; final 84 pinned source files, 36 UI includes, Foundation, M02 real local D1, M03 real local D1, M04 auth, M01 Chromium and Cloudflare PR safety checks. Leave PR draft/unmerged for owner.
