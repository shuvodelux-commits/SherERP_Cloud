# M06 Sales Detail read-only parity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve original Sales detail dialog, return economics and permission-gated profit without adding live financial writes.

**Architecture:** Compose existing `projectPostedSaleInvoice` with a small pure Sales-specific return/profit extension; frozen GAS source oracle provides the independent parity reference. No second booking/accounting engine.

**Tech Stack:** ESM JavaScript, Node 22+ built-in test/vm/crypto, GitHub Actions source/frontend + Workerd/D1 + Chromium.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-sales-detail-read.md`

## Global constraints
- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and target `AGENTS.md` source protection.
- No `src/db`, `src/rpc`, auth/permissions, migrations, Wrangler, original UI, Cash/Bank/ledger, remote D1, deployment or posting changes.
- Explicit M04 `sales:view` and separate cost rights. Only trusted original IDs. Source-shaped, tenant-filtered row snapshots from M03/M05/M07/M08.

## Review focus
1. Historical posted tender and later customer settlement must remain distinct.
2. Returns with and without `NetAfterInvoiceDiscount` cannot be double-discounted.
3. Bundle virtual parent is never charged as phantom physical lot; component coverage can be incomplete.
4. Vendor `Total Cost` overrides unit × qty only when valid and nonnegative.
5. Absence of profit rights must omit all cost/profit keys, including incomplete-cost flags.

---

### Task 1 — Baseline source oracle and failing tests
**Create:** `tests/fixtures/m06-sales-detail-oracle.mjs`, `tests/m06-sales-detail-read.test.mjs`.

- [ ] Verify frozen `SalesManagement.gs` and `Utils.gs` Git blob identities; execute original `getSaleDetail` and cost helpers in a Node VM with test-only source adapters.
- [ ] Test proration, net-priced returns, FIFO lot cost, vendor sourcing, bundle physical coverage, incomplete cost, settlement history, extra-unrelated rows, duplicates, missing snapshots and cost-permission segregation.
- [ ] Commit RED test files before production module; verify expected missing-module failure on GitHub Foundation run.

### Task 2 — Minimal read-only implementation
**Create:** `src/modules/sales-management-detail-read.js`.

**Exports:** `projectSalesManagementDetail(invoiceId,snapshot,{canViewSales,canViewProfit})`.

- [ ] Add only existing `projectPostedSaleInvoice` composition plus the original return/profit arithmetic in one internal read-only file.
- [ ] Ensure no source row mutation, no read-side accounting write or private cost leak.
- [ ] Verify GREEN source-parity tests on exact head, all `npm test`.

### Task 3 — Verify and hand off
- [ ] Run current-head `npm run verify:source`, frontend build, local Workerd/D1 aggregate, Chromium and Cloudflare previews through GitHub Actions.
- [ ] Review PR diff, file owners, exact status; keep PR draft until green and explicit owner merge approval. Document existing production activation gates and rollback (revert new files only).
