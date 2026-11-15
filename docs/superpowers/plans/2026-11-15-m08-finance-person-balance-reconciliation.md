# M08 Finance Person balance reconciliation — Superpowers plan

> **For agentic workers:** Follow `superpowers:test-driven-development` RED → GREEN → verify; keep every code/test/plan change on a GitHub branch/PR. Do not enable financial writers.

**Goal:** Reconcile one original Finance Person ID to three source-sign-correct financial accounts and six non-netted gross summary buckets, using already merged pure projections.

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `FinanceModule.gs:financePersonBalancesForUI_` / `financeBalanceSummary_` / `getFinanceBootstrap`; ADR-007. **Read-only M08 only**; no schema, SQL, RPC, finance posting, new dependency or UI work.

## Task 1 — original contracts and RED

- [ ] Read current `AGENTS.md`, `docs/M03_PARALLEL_READINESS.md`, ADR-007, merged M08 projections, FinanceModule bootstrap source and this spec. Start fresh GitHub branch on main.
- [ ] Commit source-oracle `tests/m08-finance-person-balance-reconciliation.test.mjs` importing absent `src/modules/m08-finance-person-balance-reconciliation.js`. Execute exact selected pinned GAS helpers in existing restricted test-only VM, seeded synthetic finance masters and finance transactions.
- [ ] Tests: full source `personBalances` parity and `summary`, multi-role no-net, zero-activity, inactive, duplicate names, opening baseline, negative gross buckets and per-row rounding. Fail on ambiguous/no original ID, unknown master, whitespace-altered ID, pending/deleted/unknown finance transaction, Promise. Never invent Party identity.
- [ ] Open draft PR and capture **expected GitHub Foundation RED** (`ERR_MODULE_NOT_FOUND`) before adding implementation.

## Task 2 — minimal GREEN

- [ ] Add pure `reconcileFinancePersonBalances(masterRows,activeFinanceRows)` in new M08-owned source module. Reuse `projectFinancePersonDirectory` and `projectFinanceRoleBalances`; avoid reimplementing any type effects or rounding.
- [ ] Fail closed for noncanonical/duplicate/orphan Person IDs and source-invalid active rows; return `{persons,personBalances,summary}` with one source Person ID per master, even inactive/zero-balance. The source data must remain untouched.
- [ ] Run Github Foundation Node tests; inspect the **new oracle cases** as well as the full Node/test/source/build report. Fix only observed mismatches.

## Task 3 — integration and review

- [ ] Check M01 Chromium, M02 local Workerd/D1, M03 Workerd/D1, M04 auth Workerd/D1, Cloudflare PR safety and source audit on the exact latest head; do not conflate these with real M08 financial integration tests.
- [ ] Sync concurrent main changes only when relevant; compare diff for four new M08 files and zero SQL/RPC changes.
- [ ] Document RED+GREEN run IDs, CI summary, source pin, unapproved financial release blockers and four-file revert plan. Mark ready only when 8/8 exact-head CI successful; do not auto-merge fresh PR.

**Merge sequence:** after #127 with owner review. **File owner:** M08 isolated projection files. **Depends on:** current merged M08 source directory/finance balances, no new shared transaction kernel. **Test gate:** source-executed synthetic VM parity and full GitHub CI. **Data access:** none. **Rollback:** revert four-file PR.
