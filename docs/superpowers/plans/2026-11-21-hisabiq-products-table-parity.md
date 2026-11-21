# HisabIQ Product Table parity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Port the original `hisabiq_ui` product table layout, persistent column visibility, category/stock filters, search, sorting and mobile responsive behavior to the authenticated SherERP Owner product page without changing source-backed financial/data permissions.

**Architecture:** Keep `legacy/source/products.html` and its runtime handlers intact. Attach an Owner-only DOM UI adapter and scoped HisabIQ CSS into the compiled Owner frontend; wrap the original `prodRender()` and derive rendered row identity using its original ranking/sort functions. Do not replace the Worker/D1 backend, original state, product actions or stored arithmetic.

**Reference:** `shuvodelux-commits/hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484`, `src/pages/Products.tsx` and `src/components/Table.tsx`. Use already-merged SherERP `hisabiq-design-system.css` source tokens.

**Global constraints:** Source fidelity, KISS, backend identity/permission locks, GitHub-only PR, test-first RED/GREEN, no production D1 migration, no public RPC, responsive breakpoints 320/390/768/1024/1440, preserve keyboard & touch. Exact `/ui-refine-skill` is not discoverable in this agent environment; run documented Playwright screenshots and manual visual refinement as substitute without claiming the exact skill passed.

**Review focus:** Disabled product actions stay disabled; stale stock snapshot is not shown as live current stock; hidden required columns cannot be hidden by tampered local storage; no page-level horizontal overflow at 320px; browser keyboard category, stock, column controls behave correctly; no XSS from names.

## Task 1 — Contract and adapter
- [x] Write failing contract tests for source column parity, essential column locks, stock-filter semantics, storage validation and bounded HTML injection.
- [x] Run tests to observe expected missing module failure (RED).
- [x] Implement `src/ui/hisabiq/product-table.mjs`, `src/ui/hisabiq/product-table.css`, `scripts/patch-owner-hisabiq-products.mjs`; wire build with no legacy source modifications.
- [x] Run contract tests and original Owner build (GREEN).

## Task 2 — Browser states and screenshots
- [x] Add Playwright Owner page test for search, sorts, category, stock segmented buttons, column menu, persistent choice and action preservation.
- [x] Capture baseline and final screenshot matrix for 320, 390, 768, 1024, 1440px and inspect horizontal overflow, table density, accessible popup/keyboard/focus.
- [x] Run Owner browser regressions, design system, source manifest, Owner build; recheck full unit suite and GitHub CI separately after PR.

## Task 3 — Review handoff
- [ ] Publish scoped PR; document screenshot evidence and known source-backed gaps, especially disabled stock/edit operations.
- [ ] Leave PR for review (no D1 migration, public runtime or unapproved merge).
