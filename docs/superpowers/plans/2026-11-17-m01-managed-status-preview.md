# M01 — Fail-closed managed Product Unit status in read-only preview

**Workstream:** M01 UI, issue #564; **M05 contract:** issue #563 and merged #566/#586; **M03 integrator:** #22; **coordination:** #456.
**Base main:** `e75cde4f49f511f3e95f7c07bd896cdd69bd9e81`; **frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Ownership:** `qa/m01-products-preview.spec.mjs`, `src/ui/m01-products-preview-controller.mjs`, this plan; no overlap with separate dashboard PR #613 (`qa/m01-browser.spec.mjs`, `src/ui/hisabiq-dashboard.html`).
**Scope:** Compiled-only Product UI read-only preview and Chromium fixture. No original `legacy/source/**`, `src/db/**`, `src/rpc/**`, migrations, Worker, auth, postings or D1 writes.

## Twelve-sentence implementation overview

1. Keep the original Product modal, stock table and Bundle path untouched.
2. Continue using the M05 read-only preview as the only source for unit conversions and stock text.
3. The existing M01 browser adapter currently converts every managed Unit to an `Active` row.
4. That allows an explicitly inactive or invalid Unit to appear as a valid Box/Pcs conversion in the preview.
5. First write a Chromium regression that supplies an inactive Box source row and expects a clear, nonposting validation error.
6. Verify the test fails specifically because the current preview incorrectly accepts the inactive Unit.
7. Implement the smallest M01-only change to preserve `Active` and `Inactive` source status.
8. Treat an explicitly unknown status as `Inactive` to avoid falsely authorizing a conversion.
9. Retain `Active` compatibility for existing legacy list rows that have no status field.
10. Verify that changing back to an active Unit restores the correct Box/Pcs preview while Save remains disabled in advanced mode.
11. Re-run Product browser QA, original-frontend build, source preservation, all GitHub checks and screenshot evidence.
12. Merge only after exact-head success, no conflicts, appropriate review and independent dashboard #613 ownership preserved.

## Acceptance / proof

- **RED:** New desktop Chromium case fails on missing inactive-Unit rejection, not setup or syntax.
- **GREEN:** Inactive/unknown Unit status blocks preview with `m01-error`, no false stock text or Save path; active restores `2 Box 5 Pcs`.
- Existing Tiles Box/Pcs/Sqft, mobile, Bundle, advanced edit safety and table fallback remain unchanged.
- **Rollback:** Revert this small M01-only PR; no SQL/data migration or Cloudflare binding rollback.
- **Release:** Preview only. No source-account, stock posting, financial permission, cash, bank or public RPC authorization.
