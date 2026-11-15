# Superpowers TDD plan — M02 source-to-Party role lineage

1. **Inspect contracts:** `AGENTS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, current Party planner, `legacy-contracts.js`, reconciler and Node/Workerd tests. Ensure no other open M02 PR owns the same role-lineage code. The pending separate PR #205 only checks summary source-row numbers; keep work logically independent.
2. **RED Node:** extend `tests/m02-party-import-readback.test.mjs`. Start from frozen valid reviewed plan; tamper an isolated Finance Party's role from Owner to Supplier, rebuild future-schema readback to match, and require `PLAN_LINKAGE_INVALID` even though D1-shaped records and counts agree. Remove Customer role from an approved Customer/Supplier Party by replacing with Payee, and require fail. Change a legacy source group in the plan to an unknown value but retain mirrored readback, require fail. Preserve valid reviewed Customer+Supplier and Finance Owner/Lender/Borrower multi-role positives.
3. **RED local Workerd/D1:** append one regression to `tests/integration/m02-party-plan-workerd.spec.mjs`. Starting from actually imported synthetic D1 tables, change the in-memory Finance Party role to one not permitted by its FINANCE_PERSONS link; demand privacy-safe `PLAN_LINKAGE_INVALID` and unchanged local D1 row counts. Commit tests before production change. Collect expected GitHub RED Node and Workerd failures.
4. **GREEN minimal:** in existing `validPlanLinkage`, inspect source-linked role sets from `partyLegacyContracts`. Require roles belonging to source-permitted union; all static group mandatory roles; ≥1 Finance role when linked; only known legacy source groups. Keep original IDs byte-for-byte and no new schema, lib or writer. Reuse one generic `PLAN_LINKAGE_INVALID` error.
5. **Verify:** Foundation Node suite including 84 frozen source files and original UI 36 includes; local real M02 Workerd/D1, reviewed-evidence D1, M03/M04, M01 Chromium and Cloudflare PR safety workflows. Open a draft PR with RED/GREEN evidence; do not merge while required CI is running, branch stale without validation, or approval_ref/auth release gates remain.

## Branch reconciliation and verification record

- RED test-only head `a51294a90b7bcf3f2519750f080ae4068f495384`:
  Foundation `43717841255` job `132823107375`: **1,252 passed, 3 expected role-lineage failures**, valid cross-role positive passed.
  Actual M02 Workerd/D1 `43717841252` job `132823107426`: **21 passed, 1 expected forged-Finance-role failure**.
- First GREEN head `bd6116eb7a54c82aa80353dc681d92bd9c428912`:
  Foundation `43717958897` job `132823476113`: **1,255/1,255 passed**, pinned original source **84 files**, original UI **36 includes**, and RPC transport patched.
  M02 synthetic real Workerd/D1 `43717958914` job `132823476247`: **22/22 passed**.
- While this PR was in review, M02 count-integrity PR #205 passed all nine required checks and merged as `3e3d229077052566857af37dc18d195e406e315a`.
- Reconciled this feature branch with current main, preserving the count-integrity source code and both independent readback contract / real-D1 test suites alongside the new source-to-role lineage guard. The branch was lease-reset to a verified base and five source/spec/plan paths replayed. PR #210 was reopened after the temporary zero-diff state. All GREEN checks must be repeated on the reconciled head before merge.
- No remote D1 writes, original GAS UI/ERP account changes, or production import authorization. Reviewer authorization and `approval_ref` schema persistence remain external release gates.
