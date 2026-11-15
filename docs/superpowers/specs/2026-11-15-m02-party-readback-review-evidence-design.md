# M02-P Party Import Validation — Approval Evidence Persistence

**Date:** 2026-11-15. **Workstream:** M02-P, offline Party import validation. **Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `AGENTS.md`; ADR-007. **Depends on:** merged offline Party import planner and readback reconciliation. **Separate from parallel draft PR #144:** duplicate original identity quarantine owns `src/party/party-import-plan.js`, not modified here.

## Defect
`reconcilePartyImportReadback({plan,readback})` already compares all fields of each planned `HUMAN_VERIFIED` legacy link. However, `approvalEvidencePersistent` is set false only when `approval_ref` is missing/mismatched or the entire link is missing. If D1 readback silently changes `reviewed_by`, `reviewed_at` or `link_basis`, the report correctly emits `FIELD_MISMATCH`, but still falsely claims reviewer evidence was persisted. That is an unsafe positive signal for import/cutover review.

## Chosen minimum correction
Use the existing row-by-row readback matcher. For a *planned* `HUMAN_VERIFIED` link, any missing or changed member of the approval-evidence tuple `(link_basis,reviewed_by,reviewed_at,approval_ref)` must set `approvalEvidencePersistent=false`. Preserve existing `APPROVAL_REF_NOT_PERSISTED` and fixed-vocabulary `FIELD_MISMATCH` diagnostics. Do not echo source identities, raw values, names, phones or human evidence in issues. If there are no reviewed links, a change to an unrelated original-row field can still make `identityRowsMatch=false` without falsely claiming that a nonexistent reviewed approval was lost. The result's `formatVersion`, `counts` and API remain unchanged.

Alternatives rejected: relaxing the strict field parity test; treating `identityRowsMatch` as a substitute for the separate approval-evidence flag; changing the D1 query/DDL or adding a new migration (shared M03/D1 ownership and schema gate). No new dependency or workflow.

## Acceptance
1. Identical synthetic reviewed plan/readback returns both booleans true.
2. Altered/blank `reviewed_by`, `reviewed_at`, `link_basis` or `approval_ref` on the reviewed link returns `approvalEvidencePersistent=false` and `identityRowsMatch=false`, with the existing non-sensitive mismatch diagnostics.
3. Unreviewed original-link status/phone mismatch still fails identity parity without being misreported as a reviewed approval loss.
4. Original Party plan and synthetic D1-shaped readback are unchanged; results remain privacy-safe and deterministic.
5. RED expected regression failures on GitHub Actions before the minimal production edit; then Node/source/build and existing real local Workerd/D1/browser PR checks GREEN.

## Boundaries and rollback
Modify only `src/party/import-readback-reconciliation.js`, add `tests/m02-party-readback-approval-evidence.test.mjs` and this spec/plan. Zero API/RPC changes; zero D1 tables, migrations, Worker auth/UI/deployment/finance posting changes; no remote data. Revert these four files to roll back. This validation is offline and does **not** authorize actual financial import or production cutover. M02-P source identity review remains mandatory; M08-S cross-role settlement remains disabled.
