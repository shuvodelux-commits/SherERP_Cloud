# M06 Sales Management List implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve original Sales Management list from already trusted snapshots without enabling transaction posting.

**Architecture:** One pure per-invoice source projection imports the existing M06 profit helper. Test-only VM executes frozen GAS `getSalesManagementList` with strictly deterministic pre-reconciled Customer settlement fixtures. Fail closed for missing snapshots or authority.

**Tech Stack:** JavaScript ESM, Node built-in `node:test` + `vm` + `crypto` (test-only), current GitHub CI.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-sales-management-list.md`.

## Global constraints

- `AGENTS.md`, pinned Mohim_ERP commit, existing source behavior/UI/printing and ADR-007 are immutable.
- Read models only; no `src/db`, `src/rpc`, M04 auth, source GAS, stock engine, ledger, migrations, Workers config, remote D1 or production writes.
- Source-shaped inputs must be server tenant-scoped, M04 Sales View and private cost access server-authorized. Any later transaction action must recheck in the DB-enforced posting boundary.

## Review focus

1. Duplicate invoice IDs remain visible as integrity errors with null economic sums and no editability.
2. Later Customer payments/credit replace status only for exact tracked invoice ID, not by name/phone.
3. An active Session opened AFTER a sale never makes that historical sale editable.
4. A return on ANY line forbids Update Mode even when its economic value is zero; status uses positive returned amount.
5. Absent or incomplete FIFO cost evidence must not expose exact profit, and non-cost users get zero private fields.

---

### Task 1: pinned native source oracle and regression tests

**Files:** Create `tests/fixtures/m06-sales-list-oracle.mjs`; `tests/m06-sales-management-list.test.mjs`.

- [ ] Verify exact `SalesManagement.gs`, `Utils.gs`, `CashSession.gs` Git blob identities.
- [ ] Run native `getSalesManagementList`, source profit/return/session/helpers in a test-only VM; stub only separate Customer settlement service with trusted map from fixture.
- [ ] Create positive/negative parity cases covering sorting, returns, duplicate, historical Cash Session, settled Customer, bundle FIFO/vendor, cost gate, invalid snapshots, immutability.
- [ ] Commit tests first. GitHub Foundation must fail expected missing `src/modules/sales-management-list-read.js` import (**RED**).

### Task 2: minimal source read adapter and existing profit reuse

**Files:** Create `src/modules/sales-management-list-read.js`; modify export only in `src/modules/sales-management-detail-read.js` (no algorithm change).

**Interface:** `projectSalesManagementList(snapshot,{canViewSales,canViewProfit}) -> array`; internal imported `sourceProfitMetric(invoiceId,sale,saleItems,returnItems,snapshot)` (same historical return/FIFO/vendor semantics).

- [ ] Required records/arrays, authenticated rights and trusted per-invoice current settlement validation.
- [ ] Return/status/editability/duplicate sorting mirror native list. Current paid/due only from tracked Customer settlement snapshots. No mutation/writes.
- [ ] Verify exact-head GitHub Foundation Node tests pass (**GREEN**) and unchanged original source.

### Task 3: verify and handoff

- [ ] Check final node/source/build, Chromium, Cloudflare preview safety and actual local D1/workerd jobs. No claim production-ready from these.
- [ ] Draft scoped PR documenting plan, observed RED/GREEN runs, permission/tenant gates, risks and exact checks. Wait for owner review and subsequent merge request.
