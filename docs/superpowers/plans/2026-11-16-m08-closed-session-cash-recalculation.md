# M08 — Closed/Closing Session cash recalculation: implementation plan

**Goal:** read-only source-parity `{expected,variance}` projection of native Cash Book session boundaries and late closing explanations.

**Source:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `CashReconciliation.gs:cashReconciliationRecalculateClosedSession_`. **Design:** `docs/superpowers/specs/2026-11-16-m08-closed-session-cash-recalculation-design.md`.

## Safe scope and file inventory

Create `src/modules/m08-closed-session-cash-recalculation.js` (new pure helper), `tests/m08-closed-session-cash-recalculation.test.mjs` (new original-source VM parity tests), this plan and the design spec. **No changes** to legacy source, migrations, Worker RPC registry, authentication, schema, frontend/print, Cash Book writer or Party accounts. GitHub-first, dedicated branch, Superpowers TDD (RED → GREEN → verify → review), KISS.

## Task 1 — RED

- [ ] Select exact frozen GAS function in the existing `loadPinnedGASFunctions` fixture: `Utils.gs:roundMoney_`, `CashReconciliation.gs:cashReconciliationSigned_`, `cashReconciliationIsDeleted_`, `cashReconciliationIsSynthetic_`, `cashReconciliationParseIds_`, `cashReconciliationExplanationField_`, `cashReconciliationRowById_`, `cashReconciliationLinkedUsage_`, `cashReconciliationRecalculateClosedSession_`.
- [ ] Write parity tests across positional Session Open boundaries, signed real flows, closing explanations within and after window, opening/elsewhere exclusions, soft deletion, synthetic adjustment, no counted and explicit counted zero, decimal rounding, unmodified frozen inputs.
- [ ] Write strict fail-closed tests for duplicate identifiers, unawaited Promise, invalid records, and prototype-shaped keys.
- [ ] Commit tests **before** implementation. Open a draft PR and verify GitHub Actions fails with expected missing module error.

## Task 2 — GREEN

- [ ] Implement `recalculateClosedSessionCash(session,sessionRows,cashRows)` reusing already-merged M08 parsing when appropriate. Copy no GAS runtime APIs; preserve source data ordering and rounding.
- [ ] Reject malformed ambiguities; output a value-only object/null, never save it. No external API or D1 accesses.
- [ ] Commit minimal implementation. Verify GitHub Actions full `npm test` (test count and zero failures), `npm run verify:source` and `npm run build:frontend`; read logs and correct failures, if any.

## Task 3 — Review

- [ ] Review four-file diff, check latest main and mergeability, record actual RED/GREEN SHAs, CI evidence and accounting boundaries in PR.
- [ ] Leave for owner review and no auto-merge. Financial posting/rollback and source-data migration remain separate release blockers.
