# Superpowers TDD Plan — M02-P Finance Person Text Role Evidence

> Required: `test-driven-development`, `executing-plans`, and `verification-before-completion`. Observe GitHub RED before implementing GREEN. KISS and GitHub-only.

**Goal:** Require source Finance Person role fields to match the string/null type emitted by original `FinanceModule.gs`, without inventing role authority.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Spec:** `docs/superpowers/specs/2026-11-15-m02-finance-person-role-text-provenance-design.md`.

### Task 1 — Test-first original Finance role type coverage

Paths: existing `src/party/export-column-coverage.js`, new `tests/m02-finance-person-role-type-coverage.test.mjs`, design and plan.

1. **RED:** Commit regression tests (with no production changes) constructing synthetic, fully header-complete original five master exports. Assert numeric/boolean `Roles` and `Person Type` each produce the fixed `UNSAFE_VALUE` issue; both together count two. Verify canonical strings, blanks and nullable fields remain accepted, ordinary numeric balances remain valid, downstream Party role parsing remains source-faithful, no mutation and no identity/financial data in reports.
2. **Observe RED:** Create draft PR; inspect GitHub Foundation failures on test-only SHA, identify exactly which new tests fail and which controls pass. Do not modify implementation before evidence.
3. **GREEN:** Add only `group==='FINANCE_PERSONS' && (name==='Roles'||name==='Person Type') && value!==null && typeof value!=='string'` to the existing unsafe-cell predicate in the offline source coverage validator. No role mapping edits.
4. **Verify:** Fresh exact-head GitHub Foundation Node tests, all immutable original source checks, assembled original frontend, reviewed Party D1 and gross parity Workerd/D1, M03 runtime, M04 auth, M01 Chromium, M09 as required and Cloudflare no-secrets preview safety.
5. **Review/merge:** Audit four-file diff and parallel PR overlap; record RED/GREEN evidence, exact SHAs, CI run IDs and constraints in draft PR. Do not claim all green or merge until checks complete and approval. No remote D1 changes, no production posting; rollback via PR revert.

**User/project gate:** `PARALLEL-MODULE-READY=false`; no cutover, original source edits, automatic financial merging or settlement.
