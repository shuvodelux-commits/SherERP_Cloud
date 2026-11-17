# M08 Opening Cash Reconciliation on local D1 — execution plan

**Spec:** `docs/superpowers/specs/2026-11-17-m08-d1-opening-explanation-validation-design.md` | **Issue:** #448.

### Task 1 — RED
1. Add `tests/integration/m08-d1-opening-explanation-workerd.spec.mjs`, importing absent `tests/fixtures/m08-d1-opening-explanation-schema.mjs` and `tests/fixtures/m08-d1-opening-explanation-preview.mjs`. Include real Workerd fixture setup with generated source-shaped session and cash ledgers, pinned GAS VM oracle stubs and immutable before/after snapshots.
2. Cover two-entry Cash Out and Cash In, historical baseline, previous Closing/Closed and zero-vs-null counted, linked entry already used elsewhere, missing/deleted/synthetic and one-cent gap, whole-ledger despite UI shortlist, duplicate IDs, tenant isolation, malformed request and 404 test Worker. Assert no source business data changed.
3. Add `wrangler.m08-opening-test.jsonc` with dummy local D1 UUID and dedicated PR-only no-secrets workflow `.github/workflows/m08-opening-cash-d1.yml`.
4. Commit test and config before implementation. Observe expected real GitHub Workerd RED `ERR_MODULE_NOT_FOUND`, record run link.

### Task 2 — GREEN
1. Create `tests/fixtures/m08-d1-opening-explanation-schema.mjs`: two disposable STRICT D1 tables carrying full source-facing session and Cash Book records, with (tenant,original row index) keys.
2. Create `tests/fixtures/m08-d1-opening-explanation-preview.mjs`: strict 5-field input validation, immutable parameterized tenant SELECTs via `DB.batch`, source-shaped projection (integer cents only) and existing `validateCashReconciliationExplanation`, never SQL write/read by dynamic identifier.
3. Run actual GitHub Workerd D1 suite; fix defects without relaxing accounting invariants. Confirm Foundation `npm test`, `npm run verify:source`, `npm run build:frontend`, all applicable CI and PR mergeability.

### Task 3 — review boundary
1. Document RED and GREEN immutable commit/workflow links in PR and issue. Mark ready for review, do not merge.
2. Record remaining production release gates: opening-phase Session Open retirement, source positional cash expected recalculation in a **single SQL transaction**, auth/revocation checks, actual M02 D1 schema and imported provenance, rollback/backups and owner-approved staging cutover.
