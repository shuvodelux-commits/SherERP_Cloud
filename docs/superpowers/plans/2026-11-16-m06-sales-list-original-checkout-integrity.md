# M06 Sales Management List checkout integrity — Superpowers TDD plan

**Source:** `docs/superpowers/specs/2026-11-16-m06-sales-list-original-checkout-integrity.md`.
**Goal:** A malformed original posted-sale header must not appear as a valid Sales Management row. Unchanged valid original source parity and later-settlement projections.

**Constraints:** GitHub-first; dedicated branch/PR; RED failure observed before production edits; minimal GREEN; existing D1 and source GAS untouched; owner review before merge. This change does not overlap M06 PRs #333, #313 or #373.

## Task 1 — exact paisa original checkout conservation

**Modify:**
- `tests/m06-sales-management-list.test.mjs`
- `src/modules/sales-management-list-read.js`

1. Add one RED regression using existing trusted fixture and source fields; target original `Grand=90, Paid=60, Due=30`, then corrupt one component, use missing/negative/overprecision and expect `NEEDS_REVIEW: Sales list original checkout totals mismatch`. Include valid original zero checkout with no inferred Customer/Party, and valid later-settlement projection.
2. Commit test-only change. Verify real GitHub Foundation/Node test fails specifically because current projection does not reject malformed original header; document the run and exact failure.
3. Add minimal `salePaymentPaisa_` import and per-active-row exact money guard before any list projection. Catch parser/overflow errors and raise the deterministic NEEDS_REVIEW error.
4. Commit GREEN. Run and verify exact-head full Foundation, Workerd/D1, browser and Cloudflare PR checks. Fix any caused regressions rather than ignoring failures.
5. Open/update draft PR with source, file inventory, observed RED/GREEN evidence, security and data-migration impact, rollback and production limitations. Owner reviews; no auto-merge.

**Note:** Documentation-only artifacts do not require manufactured failing tests; executable code strictly does.
