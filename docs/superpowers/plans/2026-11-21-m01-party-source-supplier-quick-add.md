# M01 Party Supplier Quick Add and Screenshot QA — Implementation Plan

**Base:** SherERP_Cloud main f26d0e0e98f0b17be4385dbdb68d784fda4c06e0.
**UI authority:** hisabiq_ui e42a00a9f48ffc1f5c4ec10083e36d9eb4686484; HisabIQ design tokens, ADR-007 and ADR-008.
**Workstream:** M01. **File ownership:** M01 Party UI source/CSS and its contract/Chromium QA. No M03 shared Worker, D1 migration, SQL, source ledger or posting changes.

**Goal:** Make the merged Party workspace useful for existing Supplier CRUD in a clean Shop without inventing generic Party writers, then prove visual and security behavior.

## Task 1 — Source-only authorized Supplier creation
- [x] RED: browser and unit tests for zero-opening payload, one authorized Supplier POST, replay-safe operation ID, denial handling, selected readback and disabled generic Party create.
- [x] GREEN: use the existing authenticated POST /api/owner/suppliers, no new backend/writer.
- [x] Handle uncertain 5xx/network save by retaining exact payload/operation ID, reject changed retries and prevent concurrent submits.
- [x] Load the real source Supplier list and select returned SUP ID. Never infer a Party identity by name or phone.
- [x] Regression: 403 fails closed and the original Supplier UI remains available.

## Task 2 — HisabIQ visual refinement
- [x] Baseline Playwright screenshots at 390px and 1440px taken before production edits.
- [x] Scope-hide misleading global Owner unconnected banner only while the verified Party view is active, preserving the scoped D1 limitation banner and existing error toasts.
- [x] Create responsive 36px-input Supplier modal, 12px radius, 180ms entrance, focus loop, reduced-motion fallback and mobile bottom sheet.
- [x] Inspect desktop/phone screenshots, identify dark gutters, add RED browser assertion, implement theme-scoped background and retest GREEN.
- [x] Capture before/after viewport matrix plus dialog and dark state; document visible limitations in the UI report.
- [x] Run affected contract, Party Chromium and original Owner ERP regression suites.

**Skill limitation:** Exact /ui-refine-skill unavailable; use pinned HisabIQ design authority, manually inspected Playwright screenshots and available Impeccable UI-review guidance without claiming the missing skill ran.

**Acceptance:** One private Supplier-only endpoint, zero opening balance, no unreviewed multi-role posting or legacy ledger deletion; all M01 tests and affected existing Owner browser tests green, reviewable image evidence in GitHub PR. Hosted Shop D1 and global required CI remain independent release gates.
