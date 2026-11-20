# M06 — MVP POS V2 source-to-posting request adapter

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize a source-shaped `completeSale` request into one canonical, strict, nonposting M06 candidate contract for M03 future authenticated Shop D1 integration.

**Architecture:** A single pure JavaScript adapter consumes the original POS V2 sales payload and a separately trusted server context. It reuses the already-reviewed source-ported M06 split-payment normalization and integer-paisa helpers, rejecting any mode that the existing one-product local M06 posting proof cannot represent. The adapter returns only an immutable intent; it has no D1 binding, Worker route, session issuance, UI change, or posting privileges.

**Tech Stack:** Node 22, JS ES modules, existing `src/modules/sale-payments.js`, source payload at `legacy/source/pos.html`, existing nondeployed `tests/fixtures/m06-sale-posting-contract.mjs`.

**Spec:** M06/M05/M07 issue #314, M03 #22, coordination #456 and `PROJECT.md` MVP P0.

## Global constraints
- Base `main@75bc5eda354f47421ec4992b61437897e1c63e05`.
- Exclusive new files: `src/modules/mvp-pos-v2-sale-intent.js`, `tests/mvp-pos-v2-sale-intent.test.mjs`, `tests/integration/mvp-pos-v2-source-to-d1-workerd.spec.mjs`, `.github/workflows/mvp-pos-v2-sale-intent.yml`, this plan.
- **No** edits to M03 owned `src/db/**`, migrations, RPC, Worker entry/bindings, Owner frontend, original source, or financial/stock kernel. Active Supplier #791 uses disjoint files.
- This is a **one standard SKU** bridge only, with source-compatible Cash, Bank, Mobile Banking, split payment and Customer due. Reject bundle, vendor sourcing, negative stock, multiple products, fractional units, drafts and invoice updates until the correct full M05–M08 engine can handle them.
- Buyer-facing full ERP must not be claimed until M03 actually connects Purchase→Sale→Return and reconciles database postings and original invoice print.
- Trusted context must supply `tenantId`, `actorId`, `operationId` and `invoiceId` as checked server identity, never from client fields. Existing source split operationId may be included only if it agrees with this trusted one.
- Use exact canonical decimal text and existing `normalizeSalePayments_` for source parity, requiring server-supplied active payment accounts.

## Review focus
- Cash sale without customer must not create a Party; unpaid or partially paid sales require a selected Customer.
- Bank and Mobile payments must reference an active, correctly typed server-trusted account; never trust browser account labels.
- Cash excess creates change **metadata only**, not additional income; due, applied and total must conserve exact paisa.
- A changed payment request with a reused operation ID must be rejected by the final M03 SQL writer; this pure adapter alone does not provide idempotency.
- Negative stock, Tiles, bundles, vendor shortage, draft and edit/return remain unsupported by this one-SKU candidate; no silent fallback or data loss.
- One client payload cannot override server tenant, actor, invoice, idempotency or cash-session authorization.

## Task 1 — RED contract
- [ ] Create tests invoking missing `normalizeMvpPosV2SaleIntent({context,payload,accountRows})`.
- [ ] Verify source single Cash, Due, Partial, Bank, Mobile and split with change, and reject any money, quantity, account, identity and unsupported source shapes that cannot be posted.
- [ ] Add PR-only Node-22 workflow, create draft PR, observe GitHub RED error for missing implementation.

## Task 2 — GREEN minimum implementation
- [ ] Validate plain own-data records and trusted context keys (tenant, actor, operation and invoice IDs).
- [ ] Verify one Standard SKU, positive integer stock units, canonical 2-decimal price/discount, source payment shape, and no unrecognized fields that could alter accounting.
- [ ] Reuse `salePaymentPaisa_` and `normalizeSalePayments_` for exact allocations; reject unbalanced or customerless due. Return the explicit one-SKU M06 candidate shape and freeze the output/payment arrays.
- [ ] Run focused green Node tests and full exact-head GitHub Actions; record external Cloudflare Builds status separately.

## Task 2B — Real local Workerd/D1 integration using existing synthetic M06 kernel
- [ ] Invoke the pure adapter with actual original POS V2-shaped payloads, then the existing **test-only** M06 sale posting contract under disposable Workerd/D1.
- [ ] Prove cash and split-tender payment movements, exact applied vs tendered change, customer-only Due, Supplier no change, stock movement and same-operation replay.
- [ ] Simulate trusted Bank deactivation **between** preflight and final SQL, and Cash Session closure; assert no invoice/stock/cash effects.
- [ ] Never mistake these synthetic M06 tables for the approved M03 Shop D1 production schema; full FIFO/Tiles/returns remain unproven.

## Task 3 — handoff and release
- [ ] Verify all changes remain new M06-owned paths; audit current open PRs.
- [ ] Document where the adapter must be consumed by the **actual** M03 Owner route, current server-side actor/tenant authority, SQL-atomic posting, idempotent receipt, Cash Session and original persistent invoice printing.
- [ ] Independent /super qa and /super review, leave PR draft; do not merge/deploy without owner authorization and successful release gates.
