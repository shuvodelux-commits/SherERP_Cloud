# M08 — Legacy automatic cash adjustment retirement preview: execution plan

**Source:** pinned Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `CashReconciliation.gs:cashReconciliationRetireLegacyAdjustment_`. **Design:** `docs/superpowers/specs/2026-11-16-m08-legacy-cash-adjustment-retirement-preview-design.md`.

**Goal:** pure source-parity read-only preview of adjustment fields that original GAS would clear after a valid explanation. GitHub is source of truth; create scoped branch and PR; use Superpowers RED → GREEN → review; KISS.

### Affected files

1. `tests/m08-legacy-cash-adjustment-retirement-preview.test.mjs` — tests and frozen-source VM oracle via `tests/fixtures/m08-legacy-source-runner.mjs`.
2. `src/modules/m08-legacy-cash-adjustment-retirement-preview.js` — new internal, read-only projection.
3. This plan and the related design doc.

No existing source, migrations, RPC/auth/Worker routes, D1 schema, frontend/print, production secrets, cash posting or original GAS/Google Sheets touched.

### Task 1 — RED first

- Load pinned functions `Utils.gs:roundMoney_`; `CashReconciliation.gs:cashReconciliationSigned_`, `cashReconciliationIsDeleted_`, `cashReconciliationRetireLegacyAdjustment_`; capture `updateRowFields_` calls only in VM test.
- Parity cases: phase-specific Type and Reference; nonzero signed movement versus balanced/zero; soft deletion; explicit and fallback row index; trimmed and blank descriptions; multiple matching rows and stable order; zeroed retry; frozen inputs; negative signed transactions; empty ledger; nonmatching records.
- Defensive malformed-import cases: Promise/nonobject array input, invalid phase, empty sessionId, duplicate nonempty Entry ID, conflicting effective target row indices and invalid target index. Source parity is claimed only for valid inputs.
- Commit tests **before** production module. Open draft PR, inspect Actions logs for `ERR_MODULE_NOT_FOUND` of new module (expected RED).

### Task 2 — GREEN implementation

- Create `previewLegacyCashAdjustmentRetirement(cashRows,{sessionId,phase})`. Check loaded records + deterministic uniqueness/rowIndex guards, source-style filter and field proposal. Do not call a write API, execute D1 SQL, or expose RPC. Preserve original exact audit text.
- Commit minimal production code. Use actual GitHub Actions logs to verify all tests plus source/build validation, and fix any regressions.

### Task 3 — Review and future boundary

- Inspect four-file PR diff, commit SHAs, CI statuses and mergeability. Include RED/GREEN and limitations in PR body; leave unmerged for owner review.
- Future financial writer must bind authenticated actor/tenant, explain real Cash Book entries, validate under a consistent D1 transaction, guarantee exactly-once reversal and session linkage with rollback/idempotency, and exercise genuine Workerd D1 integration. This PR does not implement that writer.
