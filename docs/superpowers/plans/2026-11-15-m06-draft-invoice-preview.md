# M06 Draft Invoice Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an internal, source-faithful, read-only POS draft invoice preview projection without opening financial or authentication routes.

**Architecture:** Separate parsing/projection from I/O. The adapter receives a trusted D1-shaped row, already authorized Bank account snapshot and prebuilt shop information. A test-only VM executes the untouched frozen GAS preview functions as a behavioral oracle. Reuse the existing source-exact split-payment module.

**Tech Stack:** Node.js >=22 ESM, built-in Node test and VM, existing `src/modules/sale-payments.js`, Cloudflare Workers-compatible JS.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-draft-invoice-preview-design.md`

## Global Constraints

- Frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` stays unchanged.
- Do not edit `src/db`, `src/rpc`, auth, schema/migrations, Worker entry, preview/deploy configs or existing UI.
- Explicitly forbid implicit customer lookup, monetary posting and changes to original tender/change.
- No public RPC. No live D1, financial data, staging or production changes.

## Review Focus

- Corrupted items/payment JSON returns the legacy fallback, not a different exception.
- The saved Customer ID wins over phone/name ambiguity; no Party auto-merge.
- Bank/Mobile over-tender or inactive account fails; never treats cash change as posted income.
- `Payment Detail Version` stays blank for legacy and `1` for split even if paid amount is zero.
- Caller must supply trusted bank and shop inputs; no hidden settings/db access.

---

### Task 1: Source characterization and failing tests

**Files:** Create `tests/fixtures/m06-draft-preview-oracle.mjs` and `tests/m06-draft-preview.test.mjs`.

**Interface:** `parseSaleDraftRow(row)`, `projectSaleDraftInvoice(row,{paymentAccounts,shop})`.

- [x] Add test oracle executing pinned `DraftSales.gs` and `SalePayments.gs` in test-only VM with read-only injected account and shop snapshots.
- [x] Write tests comparing real source results/errors to the intended new module; explicitly assert selected Customer ID, split tender breakdown, draft status, date and no source mutation.
- [x] Run targeted tests and record RED for missing source module before production code exists.

### Task 2: Read-only pure implementation

**Files:** Create `src/modules/sale-draft-preview.js`.

- [x] Implement the minimum parser, canonical date and relation normalizer and preview projector with `normalizeSalePayments_`.
- [x] Run targeted tests, inspect output and enforce GREEN: 10/10 passed.
- [x] Add invalid-bank/malformed-JSON tests and rerun targeted suite: 10/10 passed.

### Task 3: Verification and PR

- [x] Full `npm test`: 372/372 passed (baseline: 362).
- [x] `npm run verify:source` (84), `npm run build:frontend` (36 includes), `node --check` and `git diff --check` passed. M03 47-source caller audit also passed.
- [x] Confirm only scoped files changed; no public route/schema/deployment.
- [ ] Commit, push isolated branch, open draft PR; include exact TDD evidence and remaining production gating.

**Next:** integrate preview into a server-authorized read service only after authenticated draft ownership, Cash Session and row/date contract are reviewed. This PR does not authorize that integration.
