# M06 Saved Draft payload preflight — Superpowers TDD plan

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-payload-preflight-design.md`.
**Goal:** Independent Worker-safe pure validation of saved POS draft payload without any persistence or account movement.
**Source:** `legacy/source/DraftSales.gs::validateSalesDraftPayload_`, pinned Mohim_ERP SHA.
**Stack:** JavaScript ESM; Node built-in `node:test`/VM oracle; existing GitHub Actions Node/Cloudflare Workerd regression.

## Ownership and constraints

- M06 owns only new pure `src/modules/sale-draft-payload.js` and new tests/docs.
- **Reuse** `src/modules/sale-payments.js::normalizeSalePayments_`; no new money allocator.
- M03 owns SQL/schema/posting; M04 owns actor, role and allowed RPCs; M05 owns stock; M08 owns settlement/Cash Session.
- No original UI, source, staging/production D1 or Cloudflare binding edits, no new dependencies.
- Future M04 route must authenticate/derive tenant/roles, M03 must pass authoritative business settings and BANK_ACCOUNTS, then recheck inside D1-protected write. This helper provides no authorization.

## Task 1 — Independent native source oracle and RED tests

**Create:** `tests/fixtures/m06-draft-payload-oracle.mjs`, `tests/m06-draft-payload.test.mjs`, design and this plan.

- [ ] Run frozen `SalePayments.gs` and `DraftSales.gs` in isolated test VM with canonical GAS helper stubs (source equivalent from `Utils.gs`).
- [ ] Write 15+ source parity tests covering legacy/split structure and raw preserved row text, multi-pay on/off, invalid split account/amount/duplicate row, line and total validation, bundle/vendor/serial data, max JSON length, relationship, rounding, nonmutation, missing trusted input.
- [ ] Commit tests/docs *without* implementation, open GitHub draft PR, verify a failed GitHub Actions job with expected `ERR_MODULE_NOT_FOUND`.

## Task 2 — Minimal GREEN production pure helper

**Create:** `src/modules/sale-draft-payload.js` only.

- [ ] Normalize input fields and per-item saved snapshot precisely as source with one function. Reuse `normalizeSalePayments_` for split guard, no posting.
- [ ] Commit separately; run all GitHub checks on the new exact head. Address test failures before success claims. Refactor only for simpler code without changing parity.

## Task 3 — Evidence and review

- [ ] Verify 84 frozen GAS files, 36 frontend includes, Node full suite and existing real Workerd/D1 regressions, M01 smoke and Cloudflare no-secret preview CI.
- [ ] Confirm five new files and unchanged Worker/RPC/D1/migrations/other module ownership.
- [ ] Record RED/GREEN hashes, workflow results, upstream dependencies and rollback in PR. Leave draft unmerged for owner next approval.
