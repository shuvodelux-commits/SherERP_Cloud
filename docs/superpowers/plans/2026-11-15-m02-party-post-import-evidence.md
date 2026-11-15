# Superpowers TDD Plan — M02-P Party Post-Import Readback Evidence Gate

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m02-party-post-import-evidence-design.md`. **Original:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Task 1: RED (test first, GitHub proof)

- Add this plan/spec and new `tests/m02-party-post-import-evidence.test.mjs` only. Do **not** add the target `src/party/import-evidence-gate.js` yet.
- Build complete source-shaped *synthetic* Party input from existing fixture and audited frozen header inventory. Construct future D1-shaped synthetic readback from existing `planPartyImport`; never touch cloud D1 or real Party data.
- Tests: correct future readback, current D1 missing approval_ref, tampered reviewer/ref/time/role/source ID/status, missing/extra/duplicate stored rows; incomplete/changed source headers/financial fields and pending unapproved identities **skip** readback with null status; fail closed malformed readback/evidence; no mutation, no PII/source data or amounts in report, separate roles.
- Commit RED branch, open draft PR. Observe actual GitHub Actions `ERR_MODULE_NOT_FOUND` for missing target module with prior tests passing.

## Task 2: GREEN (pure composition)

- Add only new `src/party/import-evidence-gate.js`; reuse `validatePartyImportCandidate`, `planPartyImport`, and `reconcilePartyImportReadback`. No other module edits.
- Validate export/identity first, skip readback on block; plan current candidate only when clean; redact/count readback issues by table/code and never return data or exception details. Success must require persisted human approval evidence and full identity parity.
- Commit GREEN; verify all new tests.

## Task 3: Verify exact head

- Confirm GitHub Foundation full Node suite and 84 pinned source/36 original frontend includes; M02 identity real local Workerd/D1, synthetic rehearsal, staging local; M03 real local Workerd/D1, M04 auth, M01 Chromium, Cloudflare no-secret PR checks. Report actual pass/fail and runs.
- Confirm exactly four added files, no existing file changes, clean current main comparison, explicit no production writes, no admin approvals, no account netting. Update PR body with RED and GREEN evidence; leave draft, unmerged.

Rollback is reverting this PR; no migrations or data writes. Release gate remains closed.
