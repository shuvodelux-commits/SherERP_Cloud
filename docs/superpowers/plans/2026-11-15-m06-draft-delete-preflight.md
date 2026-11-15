# Superpowers TDD plan — M06 Saved Draft deletion preflight

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-delete-preflight-design.md`.
**Source:** frozen `legacy/source/DraftSales.gs::deleteSalesDraft`.
**Goal:** an internal, side-effect-free operation *intent* for a future CAS-protected authenticated deletion.
**Stack:** JavaScript ESM; built-in Node tests and VM-pinned GAS oracle; GitHub Actions.

## Task 1 — RED original source behavior
Add `tests/fixtures/m06-draft-delete-oracle.mjs`, `tests/m06-draft-delete.test.mjs` and both docs. The oracle stubs GAS LockService, session, permissions, synthetic `SALES_DRAFTS`, audit and deletion calls, recording native action/order without touching real Sheets. Test:
- owner with POS add, manager with sales.edit only (explicit lack of pos.view); reject other owners, owner without feature, anonymous actor.
- Numeric Version comparison, stale-before-reason error, missing/trimmed ID, first-match duplicate safety enhancement, audit existing Version, exact Source Owner ID, actor, trimmed optional reason.
- audit-before-delete intended ordering, no mutation of rows/trusted inputs, fail-closed malformed authority.
Commit **only** tests/docs; open a draft GitHub PR and verify an actual failing Node workflow on absent module (`ERR_MODULE_NOT_FOUND`).

## Task 2 — GREEN minimal implementation
Add only `src/modules/sale-draft-delete-plan.js` exporting `planSaleDraftDeletion`. Validate trusted actor/flags/timestamp and tenant-scoped rows, reproduce native feature/ownership/version rules and audit payload, reject duplicate IDs, return proposed `reply,audit,guard`. No DB or RPC access.
Commit separately, then verify all source-oracle tests and full GitHub CI.

## Task 3 — Verification and review
Collect exact-head 84 frozen original source verification, 36 original UI includes, Node full suite, M01 Chromium, M03 real local Workerd/D1 regression, M04 auth, M02 Party/staging/local import, and Cloudflare PR preview safety. Document RED/GREEN hashes and CI. Verify exactly five new files, no existing file edits and no live deletion or posting. Leave draft PR unmerged awaiting owner.
