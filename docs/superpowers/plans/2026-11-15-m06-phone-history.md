# M06 POS Phone History Read Model — Superpowers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-faithful, internal-only invoice history list projection without touching authentication, SQL or financial state.

**Architecture:** Original `findSalesByPhone` executes in a VM test oracle with frozen Utils phone/duplicate helpers and injected read-only datasets. A minimal Worker-safe pure function consumes pre-authorized active Sales rows plus externally computed settlement-status snapshots. No storage, auth, RPC, or posting in this slice.

**Tech Stack:** Node.js >=22 ESM; built-in `node:test`, `node:vm`, Cloudflare Workers-compatible JavaScript.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-phone-history-design.md`.

## Global constraints

- Original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and `legacy/source` unchanged.
- GitHub branch, commits, PR and CI are source of truth; avoid Remote Desktop Commander for routine work.
- No public phone lookup, no `src/rpc`, no customer identity merge or accounting writes; M03/M04/M08 remain the only authority for query/auth/settlement.
- Source's `Created At` sort and `Due Amount > 0.004` eligibility must remain unchanged.
- Adapt only the read model; avoid KISS-breaking duplicate wrappers or speculative pagination.

## Review focus

- Empty phone must fail even if Customer ID supplied.
- Same phone must not combine people or hide results. Explicit Customer ID **adds** other rows, it does not replace phone matches.
- Duplicate Invoice ID detected across the full active snapshot; no settlement override for ambiguous ID.
- Walk-in cash/zero due and invoice with missing Customer ID retain original stored status.
- Noncanonical phone/datetime handling must not invent a new identity or alter source data.

---

### Task 1 — Test source oracle and prove RED in GitHub Actions

**Files:** `tests/fixtures/m06-phone-search-oracle.mjs`, `tests/m06-phone-search.test.mjs`, these docs.

**Interface:** `projectPosPhoneInvoiceHistory(phone, customerId, {activeSales, currentSettlementByInvoice}) -> result[]`.

- [ ] Write source VM fixture, asserting output against the exact pinned source `findSalesByPhone` with stable source rows and settlement resolver stub.
- [ ] Add positive and failure-case parity tests and explicit checks for ambiguous same-phone identities, sort, duplicate map and conditional settlement.
- [ ] Commit tests/spec/plan on fresh GitHub branch, open draft PR; record exact CI **RED** missing-module failure before production code exists.

### Task 2 — Implement minimum GREEN

**File:** `src/modules/pos-invoice-phone-search.js`.

- [ ] Implement pure phone comparison, duplicate detection, time/date formatting and projection using already-trusted inputs; no I/O.
- [ ] Commit as separate GREEN commit, let exact-head GitHub Actions prove source parity and full test suite.

### Task 3 — Review and handoff

- [ ] Verify all CI workflows, original 84-source integrity, 36-include frontend build, complete Node tests, Workerd/D1 regression and existing UI smoke.
- [ ] Verify only five new scoped files; no RPC, D1 schema or deployment behavior changes.
- [ ] Leave draft PR for owner review and next safe step; do not activate `findSalesByPhone` until M02-P/M03/M04/M05/M08 gates pass.
