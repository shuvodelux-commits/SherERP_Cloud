# Superpowers plan: M06 Saved Draft update preflight

**Date:** 2026-11-15. **Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-update-preflight-design.md`.
**Goal:** small source-faithful, internal-only preflight for `DraftSales.gs::updateSalesDraft`, without persistence.
**Ownership:** new M06 files only, no shared M03/M04/M05/M07/M08 files.
**Stack:** ESM Node test, original pinned GAS via isolated `node:vm`, actual GitHub Actions runs.

## Task 1 — RED original-source tests and plan
**Create:** this plan, design spec, `tests/fixtures/m06-draft-update-oracle.mjs`, `tests/m06-draft-update.test.mjs`.
- [ ] VM source oracle from **unmodified** `DraftSales.gs` + `SalePayments.gs`; inject read-only synthetic actor permission and frozen timestamp; capture simulated `updateRowFields_` and `appendSalesDraftAudit_` results instead of real Sheet writes.
- [ ] 15+ cases: source owner/manager, pos.view gate, sales.edit feature path, trimmed ID, missing ID, exact other-owner rejection, stale versions, source-shaped all 16 update fields, audit action/actor/version, Husband omitted selector fallback versus explicit reset, split payments/invalid account and product payload, input immutability, ambiguous duplicate IDs fail-closed.
- [ ] Commit tests/docs **before production module** and confirm an actual GitHub Actions failure `ERR_MODULE_NOT_FOUND` for absent `src/modules/sale-draft-update-plan.js`.

## Task 2 — GREEN pure module
**Create:** `src/modules/sale-draft-update-plan.js` only.
- [ ] Call existing `projectSaleDraftDetail` with all caller-trusted, server-derived authorization and pre-tenant-filtered active draft rows; find exact row; compare source numeric Version.
- [ ] Call existing `validateSaleDraftPayload` with trusted settings and active BANK_ACCOUNTS snapshot, preserve relationship if form omitted selector, build precise `fields` and `reply`/audit metadata, no mutation or I/O.
- [ ] Commit, verify native parity & failure paths and all exact-head GitHub CI. Do not add a D1 writer.

## Task 3 — Review readiness
- [ ] Inspect all GitHub PR CI statuses, Foundation Node suite, 84 pinned sources and 36 original UI includes, M03 local actual Workerd/D1 regression, M04 auth, M01 Chromium, M02 local staging, Cloudflare PR safety.
- [ ] Confirm exactly five new files, no existing file edits, no PR conflict and no remote D1/production bindings.
- [ ] Document RED→GREEN commit and workflow evidence, downstream release gates and no-data rollback in draft PR.
- [ ] Leave PR open/unmerged pending owner next merge instruction. Treat a changed main as new verification requirement.
