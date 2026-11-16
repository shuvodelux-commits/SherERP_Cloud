# M06 Original Checkout Invoice Integrity — Superpowers TDD Implementation Plan

> **For agentic workers:** Use Superpowers TDD. Commit regression tests, observe real RED on GitHub, then implement minimally and verify exact-head GREEN. Do not auto-merge or deploy.

**Goal:** Reject a corrupted original posted-sale header when original Paid + Due differs from Grand Total.

**Architecture:** A tiny preflight in `projectPostedSaleInvoice` validates the original sale header with the existing `salePaymentPaisa_` exact-paisa utility. The original payment breakdown, source-shaped invoice fields, and later-settlement snapshot remain unchanged.

**Tech Stack:** Node ESM `node:test`, GitHub Actions, existing pure M06 read projection.

**Spec:** `docs/superpowers/specs/2026-11-16-m06-original-payment-integrity.md`

## Global constraints
- Source pinned Mohim_ERP remains immutable. No live D1, GAS, Worker RPC or financial ledger writes.
- Trusted source-shaped input; no newly exposed public invoice lookup.
- Preserve original split-payment and subsequent settlement behavior without netting Party roles.
- No overlapping edits to M06 synthetic posting PR #333 or multi-unit PR #313.

## Review focus
- Original due off by one paisa must fail even if child payments balance with original paid.
- Negative or three-decimal original amount must fail rather than display a plausible total.
- Full Cash sale, all-due invoice, zero-value sale and existing legacy payment source parity stay valid.
- Later settlement differs from original Paid/Due: this must remain valid.
- Replay/write paths and Cash Session are out of scope.

### Task 1 — Original checkout conservation

**Files:**
- Modify: `tests/m06-posted-invoice-read-model.test.mjs`
- Modify: `src/modules/sale-invoice-read-model.js`

**Interface:** `projectPostedSaleInvoice(invoiceId, snapshot)` unchanged.

- [ ] Step 1: Write tests proving a trusted original sale with Grand=100, Paid=70, Due=30 is valid, but Due=30.01 or malformed negative/overprecision Paid/Due/Grand throws `NEEDS_REVIEW: posted invoice original checkout totals mismatch`.
- [ ] Step 2: Commit tests only; observe exact RED failing for missing expected exception, not a test fixture error; capture GitHub job link.
- [ ] Step 3: Add small validation using `salePaymentPaisa_` and safe-integer conservation before `readSalePaymentBreakdown_`. Do not validate current later settlement values against original.
- [ ] Step 4: Commit GREEN, verify full exact-head Foundation and all sibling GitHub CI including real local Workerd/D1 and browser checks.
- [ ] Step 5: Open/update a draft PR with changed-file inventory, RED/GREEN links, remaining blockers and no production rollout claim. Do not merge.
