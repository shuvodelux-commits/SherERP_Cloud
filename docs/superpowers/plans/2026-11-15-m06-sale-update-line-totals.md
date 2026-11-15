# M06 Sale Update line-total precision plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent hidden invoice-edit rounding changes to unchanged original auto-priced lines, without implementing Sales posting.

**Architecture:** Pure source-shaped line calculation module with a test-only original GAS oracle. The caller supplies an exact original Invoice ID, tenant-scoped old rows and submitted POS item candidates; no D1 reads or writes.

**Tech Stack:** JavaScript ESM, Node built-in test/vm/crypto, GitHub Actions verification.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-sale-update-line-totals.md`

## Global Constraints

- Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and target `AGENTS.md` plus ADR-007.
- No legacy GAS/UI, `src/db`, `src/rpc`, migrations, Wrangler, Cash/Bank, stock, finance, auth, real D1 writes, source application state or deployment changes.
- Input rows come from authenticated trusted tenant-scoped M03/M04; this is no authorization to update invoices.

## Review Focus

1. Unchanged old line with saved fractional total must retain it exactly even if visible multiplication differs.
2. Quantity/price tolerance is `abs(diff) < 1e-9`, not rounding-to-two-decimals or `<=`.
3. Blank, invalid, negative or non-finite old line total uses native rounded multiplication.
4. Sequential subtotal rounding must equal frozen source order (not `roundMoney_(sum(lines))`).
5. New duplicate Product IDs, malformed trusted rows or numeric overflow fail closed before any effect.

---

### Task 1: Original GAS oracle and RED tests

**Files:** Create `tests/fixtures/m06-sale-update-line-totals-oracle.mjs`; create `tests/m06-sale-update-line-totals.test.mjs`.

**Interfaces:** Native `originalSaleUpdateLineTotal(oldRow,qty,unitPrice)`; `originalRoundMoney(value)`.

- [ ] SHA-verify frozen `SalesManagement.gs` and `Utils.gs`; extract original named functions to a test-only Node VM.
- [ ] Write source-parity scenarios and guarded rejection cases, including exact input invoice filtering and unchanged state.
- [ ] Commit test-only files before target implementation; run exact-head GitHub Foundation and observe expected absent `src/modules/sale-update-line-totals.js` import **RED**.

### Task 2: Minimal source-safe computation

**Files:** Create `src/modules/sale-update-line-totals.js`.

**Interface:** `planSaleUpdateLineTotals(invoiceId,oldItems,newItems) -> {subtotal,lines}`.

- [ ] Validate trusted plain rows, finite new qty/price, nonblank Product IDs, unique new Product IDs, caller-provided exact invoice ID.
- [ ] First historical row by Product ID; preserve old exact amount within tolerance; otherwise original `roundMoney_`. Accumulate rounded subtotal per new line.
- [ ] Confirm native source fixture parity and failure safety in exact-head **GREEN** CI.

### Task 3: Verify, document and handoff

- [ ] Full Foundation source checks/Node/browser build, exact-head Workerd/D1 synthetic suite, Chromium and Cloudflare PR safety.
- [ ] Check PR changes only spec, plan, oracle, tests and pure helper. Keep draft until all checks pass and owner approves merge.
