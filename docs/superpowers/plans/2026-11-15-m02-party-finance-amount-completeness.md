# M02-P Finance transaction Amount completeness — Superpowers test-first plan

> Use Superpowers design → RED → GREEN → verify; all code through a dedicated GitHub branch and PR, not a local working copy. No production or shared remote D1 access.

**Goal:** Prevent a missing, blank or zero *active* finance transaction amount from being silently treated as zero in the offline Party gross-balance preflight. Preserve existing master balance and historical opening semantics.

**Source / contract:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `FinanceModule.gs` validates original writer `payload.amount` strictly positive; `AGENTS.md`, ADR-007; spec `docs/superpowers/specs/2026-11-15-m02-party-finance-amount-completeness-design.md`.

**Owner & paths:** one existing `src/party/gross-balance-preflight.js`; one new `tests/m02-party-finance-amount-completeness.test.mjs`; this plan and spec. No overlap with concurrent PR #161 D1 approvalRef readback, #160 reviewer identifiers or #158 review queue. No auth/SQL/RPC/remote DB/finance posting.

## Task 1 — RED
- [ ] Read repository rules, M02-P/ADR and exact pinned original source amount writer validation.
- [ ] Commit synthetic Node tests to GitHub **before** production change: missing/null/blank/zero Finance Amount fail closed; nondeleted positive entries keep exact account totals, deleted rows bypass amount validation, negative and subpaisa behavior unchanged. Assert no report PII or source data mutation.
- [ ] Create draft PR and inspect GitHub Foundation RED log for expected targeted assertion mismatch (not `ERR_MODULE_NOT_FOUND` or test setup failure).

## Task 2 — minimum GREEN
- [ ] In Finance transaction row loop of `gross-balance-preflight.js` only, validate presence/nonblank of `Amount` before the existing converter, and `amount===0` after it. Leave master balance converter, role ID matching, existing negative behavior, and signed money math untouched.
- [ ] Re-run new tests and full GitHub Foundation (Node/source pin 84/84/frontend 36 includes); log exact head and test counts.

## Task 3 — integration & owner review
- [ ] Confirm eight exact-head GitHub Actions workflows, including actual local Workerd/D1 M02 Party, M03, M04, M01 Chromium and Cloudflare safety. Do not equate these with *real finance* D1 cutover/ledger validation.
- [ ] Recompare with latest `main`; sync nonoverlapping concurrent changes if needed. Confirm exactly four intended files in PR.
- [ ] Document RED → GREEN run IDs, verification evidence, limitations and rollback. Mark ready only if all exact-head required checks pass, then hand off PR for owner merge. Never auto-merge a newly created PR without owner instruction.

**Blockers unchanged:** M02-P approved identity link/provenance with D1 proof, source financial reconciliation, M03/M04 atomic writer/auth gates and owner-authorized cutover. M08-S disabled.
