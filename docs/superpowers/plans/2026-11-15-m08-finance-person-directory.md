# M08 Finance Person directory — Superpowers TDD implementation plan

> **For agentic workers:** execute test-first RED, minimum GREEN, verify/refactor, GitHub PR evidence. No financial writes.

**Goal:** source-faithful Owner/Lender/Borrower Finance Person master read projection from original ID-bearing source rows.
**Architecture:** pure `src/modules/m08-finance-person-directory.js`, projected list only. No Party linking, D1, RPC or auth. Test selected original frozen GAS functions through existing M08 VM.
**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/FinanceModule.gs`.
**Design:** `docs/superpowers/specs/2026-11-15-m08-finance-person-directory-design.md`.

## Task 1 — scope & RED evidence
- [ ] Confirm current `AGENTS.md`, M03 parallel readiness, M08 workstream, finance source role helpers; branch from current GitHub `main` with exclusive M08 file ownership.
- [ ] Add `tests/m08-finance-person-directory.test.mjs` **before production module**. Use original `financeCanonicalRoles_`, `financePersonRoles_`, `getAllFinancePersonsForUI_`, `getActiveFinancePersonsForUI_` as test-only VM oracle; constant original role order through stub. Test both output shapes, fallback precedence, mixed roles, identity isolation, active-only, description fallback, no mutation and fail-closed invalid/duplicate IDs.
- [ ] Create draft PR at test-only head and prove GitHub Foundation expected `ERR_MODULE_NOT_FOUND` RED.

## Task 2 — minimum GREEN
- [ ] Add pure `src/modules/m08-finance-person-directory.js` with `projectFinancePersonDirectory(rawRows,{activeOnly=false}={})`. Require loaded rows and unique exact original `Person ID`, nonblank `Person Name`. One master per ID, no name/phone-based link.
- [ ] Implement canonical ordered role parsing and legacy fallback, original all/active-only field mapping. Preserve row order and do not mutate input; no financial balances or cross-role account netting.
- [ ] Capture Foundation GREEN check; fix only verified test failures.

## Task 3 — integrated verification / PR
- [ ] Verify full GitHub Node suite, pinned 84-file source audit, original frontend build, all M01–M04 local Chromium/Workerd/D1 and Cloudflare PR safety workflows.
- [ ] Sync unrelated concurrent `main` changes into branch without touching protected files; rerun checks on exact head. Compare to `main`: four new M08-only files, zero SQL/RPC changes.
- [ ] Update PR with RED/GREEN evidence, source oracle vs real D1 limitations, file/RPC/table effects, rollback. Mark ready for owner review **only after all CI checks pass**. Do not merge newly created PR without owner request.

**Blocked:** financial master data import/link reconciliation, live finance person RPC edits, accounting posts, real finance D1 idempotency/rollback, M08-S settlement. These require M02-P/M03/M04/M06 gates and owner approval.
