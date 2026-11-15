# M06 Sales Draft List Read Projection — Superpowers TDD Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port exactly the source-visible `getSalesDraftList` list projection into one internal Worker-safe pure function with native VM parity tests, without activating persistence or RPCs.

**Architecture:** A test-only oracle executes the frozen `DraftSales.gs` function with fake preauthorized user and source rows. The production helper takes pre-filtered tenant-scoped draft rows plus an explicit trusted actor ID and a `sales.edit`-derived manager boolean. No database reads/writes, payment or source UI changes.

**Tech Stack:** Node ESM (>=22), `node:test`, `node:vm`, GitHub Actions and existing Workerd D1 regression.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-list-read-design.md`

## Global Constraints

- Source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` is immutable; no `legacy/**` modification.
- Only M06 list read module + scoped tests/docs; no `src/db`, `src/rpc`, auth, production D1 migration, Cash/Bank, Stock, Party, Worker binding or source frontend.
- GitHub is source of truth; no Remote Desktop Commander for normal source editing; preserve other modules' file ownership.
- Later M04 caller must check `pos.add OR sales.edit` and set actor/manager flags exclusively from server-side trusted session; M03 must tenant-scope source rows.
- Maintain source lookup, sort, output and numeric defaults; KISS.

## Review Focus

- Actor who cannot manage all must never see another owner's row.
- Manager `sales.edit` sees all but `mine` remains accurate, without creating Party permissions.
- `Updated At` sort must supersede backdated Draft Date.
- Null/sheet-blank money and Version fallbacks match source; do not leak `Items JSON` or `Payment JSON`.
- Empty actor ID or missing `manageAll` are unsafe inputs; fail closed even if source assumes upstream authentication.

---

### Task 1 — Native oracle and RED regression tests

**Files:** Create `tests/fixtures/m06-draft-list-oracle.mjs`, `tests/m06-draft-list.test.mjs`, this spec and plan.

**Interface:** `projectSaleDraftList(draftRows, {actorId,manageAll}) -> Array<draft-list-object>`.

- [ ] Implement test-only VM with source `getSalesDraftList`, fake `SALES_DRAFTS` reads and M04-style session permission stubs.
- [ ] Assert 10+ source parity tests covering only-own, manager, empty, date/sort, exact fields, defaults, permissions in native oracle, trusted inputs, immutability.
- [ ] Commit tests first to a fresh branch, create draft PR; **verify exact PR GitHub CI RED** due to missing `src/modules/sale-draft-list.js`, not unrelated failure.

### Task 2 — Minimal GREEN implementation

**File:** Create `src/modules/sale-draft-list.js`.

- [ ] Implement only the pure projection following source exact field names and sort/default semantics with validated trusted context.
- [ ] Commit second, verify targeted source parity and full Node `npm test` in GitHub Actions.
- [ ] Record any source deviation and consciously reject extra mutation or auth functions.

### Task 3 — Full branch review and handoff

- [ ] Verify all exact-head GitHub Actions (full Node suite, 84 frozen source, 36 original frontend includes, M03 real Workerd/D1 regression, M01 browser smoke, preview no-secret safety).
- [ ] Confirm only five new files; no cloud/real D1 writes or public RPC.
- [ ] Update PR body with RED→GREEN evidence, affected-file/RPC/table inventory, release blockers and rollback. Keep unmerged for owner approval.

