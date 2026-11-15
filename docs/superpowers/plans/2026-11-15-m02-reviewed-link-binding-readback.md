# M02-P Reviewed Link Binding Evidence Readback Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Follow one task with test-first RED → GREEN and fresh GitHub verification.

**Goal:** Ensure a reviewed legacy link cannot report persistent human-approval evidence when the stored Party binding or original source row differs.
**Architecture:** Reuse the existing readback comparison and `FIELD_MISMATCH` reporting; extend its existing reviewed-link evidence condition by two bound fields, no new module or DB changes.
**Tech Stack:** JavaScript ES modules, Node `node:test`, existing GitHub Actions.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-reviewed-link-binding-readback-design.md`

## Global constraints

- Frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` original read-only.
- No Party automatic merge, no source ID remapping, no financial role netting, no data migration, public RPC or production D1 writes.
- Dedicated GitHub branch and draft PR; tests must visibly fail before production modification. `PARALLEL-MODULE-READY=false`.
- Preserve current report shape, redacted fixed-vocabulary issues, and status/approval evidence separation.

## Review focus

- A persisted approval tuple on the wrong Party is NOT reliable approval evidence.
- A persisted approval tuple on the wrong original sheet row is NOT reliable provenance.
- An ordinary status edit does not itself prove approval tuple loss.
- An unreviewed link has no human-approval evidence to lose.
- Source IDs/approval refs must never leak in diagnostics.

---

### Task 1 — Strict reviewed-link binding evidence

**Files:**
- Create: `tests/m02-party-readback-reviewed-link-binding.test.mjs`
- Modify: `src/party/import-readback-reconciliation.js` (the existing `FIELD_MISMATCH` evidence predicate only)
- Create: these spec and plan files.

**Interfaces:** `reconcilePartyImportReadback({plan,readback})` existing response `{formatVersion,identityRowsMatch,approvalEvidencePersistent,counts,issues}`.

- [ ] **Step 1 — RED:** create synthetic reviewed-plan tests: change stored `HUMAN_VERIFIED` `party_id` and `legacy_sheet_row` one at a time; assert `approvalEvidencePersistent === false`, unchanged `FIELD_MISMATCH` details and source/report redaction; control on exact readback; unreviewed Party mismatch and status-change controls.
- [ ] **Step 2 — observe RED:** commit spec/plan/tests with zero production edit; open draft PR and read GitHub Foundation failing log to verify precisely these two expected failing cases.
- [ ] **Step 3 — GREEN:** add `party_id` and `legacy_sheet_row` to the reviewed-link binding evidence field predicate; do not broaden to status or unrelated tables.
- [ ] **Step 4 — verify GREEN:** GitHub Foundation full Node/source-verify/frontend build; M02 real local Workerd/D1, M03/M04 local Workerd/D1, M01 Chromium, M02 staging local and no-secret Cloudflare safety; report pending/failure accurately.
- [ ] **Step 5 — review:** confirm four-file diff and current mergeability, document RED/GREEN and rollback in PR, leave draft/unmerged pending owner.
