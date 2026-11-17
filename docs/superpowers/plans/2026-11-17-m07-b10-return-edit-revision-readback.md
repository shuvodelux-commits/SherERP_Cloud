# M07-B10 Return Edit Readback After Price-Only Corrections — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or subagent-driven-development; perform test-first RED, verify expected failure, minimal GREEN, full GitHub CI and review.

**Goal:** Make the existing M07-B6 synthetic, read-only `getReturnForEdit` projection display the *effective latest Cash or Store Credit amount* from merged M07-B7/B8 price-only revisions and fail closed on contradictory revision/ledger evidence.

**Architecture:** Amend only the existing M07-owned, tenant-scoped D1 read projection `tests/fixtures/m07-return-edit-read-contract.mjs`. Extend its existing integration suite `tests/integration/m07-return-edit-read-workerd.spec.mjs` to load the already-reviewed B7/B8 local-D1 schemas and use their test-only correction contracts; do not add or change schema/posting/Worker files. The source Return header and original Cash/Customer ledger remain immutable, while revision receipts and adjustment rows establish effective amount and `Edit Version`. The readback uses one parameterized SELECT and never updates D1.

**Tech stack:** Node ESM, Wrangler real local Workerd/D1, existing `wrangler.m07-return-edit-read-test.jsonc`, GitHub Actions. Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `SalesReturn.gs::getReturnForEdit`, `prepareSalesReturnChange_`.

## Coordination and ownership

- **Workstream:** M07; primary issue [#314](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/314); central board [#456](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/456).
- **Base `main` SHA:** `666dd0ca5e0632dbc5bb3fb75c4584e0433d36ec`, from merged coordination PR #455.
- **Merged dependencies:** M07-B6 PR #378 (readback), M07-B7 PR #410 (Cash correction), M07-B8 PR #420 (Store Credit correction), M07-B9 PR #427 (quantity preflight); B9 final-head 34/34 checks passed.
- **Exact files owned:** `docs/superpowers/plans/2026-11-17-m07-b10-return-edit-revision-readback.md`; `tests/integration/m07-return-edit-read-workerd.spec.mjs`; `tests/fixtures/m07-return-edit-read-contract.mjs` (M07-specific only).
- **Read/write scope:** docs + isolated tests + test-only internal read projection. **D1 read-only in the implementation;** the integration tests set up their own isolated D1 using existing M07 schemas.
- **Protected shared surfaces (no modification):** `src/db/**`, `src/rpc/**`, `src/index.js`, `migrations/**`, shared posting/invoice/stock IDs, `wrangler*.jsonc`, `AGENTS.md`, `docs/WORKSTREAMS.md`, public Worker, production D1, legacy GAS and UI.
- **Integrator:** M03 exclusively owns shared D1/transaction kernel; M04 actor/RBAC; M05/M06 source stock/sale interface. No M03 integration requested in this PR.
- **Merge sequence:** PR #378 → #410 → #420 → #427 already on main; this isolated B10 PR targets `main` alone. Owner review and full exact-head CI required. Do not auto-merge.

## Acceptance and Superpowers TDD tasks

### Task 1 — RED on real local D1

- [ ] Preserve existing B6 readback tests; import B7/B8 existing DDL/contract into the **M07-owned** B6 test suite without new Wrangler/aggregator files.
- [ ] Test Cash corrections after 1–2 revisions; original Cash refund must remain immutable, but readback must show the latest corrected total and version.
- [ ] Test Store Credit corrections after 1–2 revisions; original Customer credit ledger remains immutable, signed due/advance and effective read amount agree, other accounts unchanged.
- [ ] Test tampered Cash adjustment or edited `Edit Version`; return `NEEDS_REVIEW`, never original amount as valid.
- [ ] Test tampered Store Credit signed balance and adjustment ledger; return `NEEDS_REVIEW`.
- [ ] Test unchanged Cash Session read behavior, cross-tenant isolation, deleted return behavior, and no public read/edit endpoint.
- [ ] Commit tests alone and run the current-head GitHub M03 real Workerd/D1 check; verify **assertion failure** for revision readback rather than missing module/import/schema.

### Task 2 — GREEN with minimal read-only fix

- [ ] Extend existing SQL SELECT with tenant-bound latest correction receipt + adjustment evidence and version/count/signed balance verification.
- [ ] Preserve original historical Cash/Store Credit evidence checks, and require correction ledger deltas to reconcile exactly to latest effective amount.
- [ ] Reject missing, tampered, mixed-method, duplicated, stale-version or changed-Customer correction evidence as `NEEDS_REVIEW`.
- [ ] Return effective amount in `header.totalReturnPaisa` and `items[].amountPaisa`, with real `version`; preserve no-revision B6 behavior.
- [ ] Avoid D1 writes, new dependencies and client-configurable SQL.
- [ ] Run full exact-head CI: Foundation Node/source build, M03 real local Workerd/D1, Cloudflare PR safety, Playwright/Chromium, all other required workflows.

### Task 3 — Review and release

- [ ] Record RED and GREEN SHA/run/job logs and current-head full CI totals in PR template.
- [ ] Leave draft/unmerged until verified full checks and owner review; check main and file ownership before final merge.
- [ ] Revert only these 3 M07-only files to roll back this test-only readback change. No business data rollback needed.

## Non-goals / release blockers

This is **not** the full frozen GAS return-edit DTO, signed `returns:edit` authority, or a production financial read endpoint. No native quantity/method change, multi-unit/tiles/bundle/vendor/OVERSOLD proof, source historical Cash Session, split-tender sale, actual Party settlement, migration/import or production cutover is authorized. M02 identity mapping, M03 shared atomic posting, M04 trust boundary, M05 inventory, M06 POS and M08 Customer ledger integration remain separate gates. Only approved parallel preparation/isolated proofs are permitted by `docs/PARALLEL_EXECUTION.md`.
