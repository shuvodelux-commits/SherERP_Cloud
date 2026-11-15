# M06 Posted Invoice Reprint Projection — Superpowers TDD Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare an internal read-only posted-invoice reprint projection with native checkout/settlement distinction, without activating invoice RPC or financial writes.

**Architecture:** Feed pre-authorized, pre-resolved source-shaped D1 result sets and prebuilt shop payload into a pure Worker-compatible projector. Compare all outputs and errors against untouched `Invoice.gs` and `SalePayments.gs` in a test-only VM.

**Tech Stack:** Node.js 22+ ESM; existing source-faithful `src/modules/sale-payments.js`; built-in `node:test` + VM; Cloudflare Workers-safe JS.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-posted-invoice-projection-design.md`

## Global constraints

- Source pinned to `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; do not modify `legacy/**`.
- GitHub-only isolated branch and PR; do not use local PC unless genuinely required.
- No `src/db`, `src/rpc`, `src/auth`, migration, Wrangler, deployment, browser/UI, or accounting writes.
- Preserve original tender history separately from later customer ledger settlement; never net independent Party obligations.
- Caller—not this module—must authorize POS read, enforce tenant/actor/row ownership and supply a consistent D1 snapshot.

## Review focus

- V1 payment-child corruption must fail closed, not silently present legacy fallback.
- Later customer collection changes current paid/due status but not original checkout child tenders.
- Invoice ID collision fails; the projector must never pick an arbitrary duplicate header.
- Legacy relationship fallback preserves source ID and old Father semantics; never match by phone/name.
- Canonical date/time and empty due-date setting keep original invoice print payload shape.

---

### Task 1 — Characterization RED

**Files:** `tests/fixtures/m06-posted-invoice-oracle.mjs`, `tests/m06-posted-invoice.test.mjs`.

**Interface:** `projectPostedInvoice(invoiceId, {saleRows,itemRows,productRows,customerRows,paymentRows,settings,settlement,shop})`.

- [ ] Create test-only GAS oracle with injected, read-only source tables and setting / settlement hooks.
- [ ] Assert source-vs-port parity for split/legacy/v1-unpaid invoices, relation snapshots, paid/due after settlements, corrupt children, missing/duplicate/deleted invoices, date/time, due date, no mutations.
- [ ] Commit test-only code on GitHub, open draft PR and record a GitHub CI **RED** caused by missing implementation module.

### Task 2 — Minimal read-only GREEN

**Files:** `src/modules/posted-invoice-preview.js`.

- [ ] Implement source-faithful pure projection using existing `readSalePaymentBreakdown_`, explicit trusted dependencies, canonical date/time helpers; no DB, no runtime RPC.
- [ ] Commit to same PR and verify fresh **GREEN** GitHub Actions `npm test` and other checks.
- [ ] If failures occur, fix code/test mismatches with new GitHub commits, no invented test evidence.

### Task 3 — Review gate

- [ ] Verify `npm run verify:source` (84 files), `npm run build:frontend` (36 includes), `npm test` and D1 regression CI results on exact head.
- [ ] Verify changed files stay in this plan/spec, fixture, test and one pure module.
- [ ] Leave PR unmerged for owner review; document no live financial or authentication activation.

**Production release blocker:** M02-P data links, M03 owned D1 posting/repository, M04 session + permission authority, M05 lot/FIFO, M08 settlement/Cash Session, source-accurate browser and print parity.
