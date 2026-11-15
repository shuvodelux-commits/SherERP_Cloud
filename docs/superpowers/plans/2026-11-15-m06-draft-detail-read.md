# M06 Saved Draft Detail Read — Superpowers implementation plan

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-detail-design.md`.
**Goal:** Source-parity internal Saved Draft detail read with owner/manager + POS permission checks; no public RPC.
**Stack:** ESM JavaScript, Node `node:test` + native `node:vm` source oracle, CI GitHub Actions, existing Workerd/D1 regression.
**Source:** `DraftSales.gs::getSalesDraft`, `requireSalesDraftFeatureAccess_`, `requireSalesDraftAccess_`, `parseSalesDraftRow_` pinned at source SHA.

## Boundary
- New M06 module uses `src/modules/sale-draft-preview.js::parseSaleDraftRow` unchanged.
- M04 trusted actor/permissions and M03 tenant-scoped draft rows are supplied by a future caller. This function **does not** grant permissions or read D1.
- No CAS/posting updates or change to source/UI/D1/migrations/RPC/auth/Cloudflare.

## Task 1 — RED native source behavior
**Create:** test-only `tests/fixtures/m06-draft-detail-oracle.mjs` VM of original `DraftSales.gs`, 12+ `tests/m06-draft-detail.test.mjs` assertions, spec+plan.
- [ ] Owner+manager+view visibility and both feature gates; selected source ID; saved items/split payments; malformed JSON fallback; immutable snapshot; source `Version`, Husband/Father.
- [ ] Document stricter duplicate fail-closed safety check separately from native GAS first-row behavior.
- [ ] Commit only tests/docs on fresh GitHub branch, open draft PR and verify GitHub Actions expected `ERR_MODULE_NOT_FOUND` before adding production module.

## Task 2 — GREEN minimal pure module
**Create:** `src/modules/sale-draft-detail.js`.
- [ ] Validate trusted actor, booleans and source row snapshot; mirror native errors and access checks.
- [ ] Look up trimmed Draft ID, reject duplicates, reuse `parseSaleDraftRow` for exact content, append `mine` and `canManage` only.
- [ ] Commit separately, verify all source parity and security checks via full GitHub CI. Keep implementation concise.

## Task 3 — CI, PR, review
- [ ] Collect exact-head GitHub Actions Node, real Workerd/D1, browser and Cloudflare safety results; distinguish this pure projector from a live D1 detail endpoint.
- [ ] Confirm five added files and no existing file modifications. Document RPC, ledger, inventory, D1 and rollback effects (none).
- [ ] Leave draft PR unmerged until owner approves. `PARALLEL-MODULE-READY=false` until explicit shared gate.
