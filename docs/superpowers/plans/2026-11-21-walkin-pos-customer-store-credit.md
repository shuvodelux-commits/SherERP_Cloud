# Walk-in POS, Quick Add Customer and Store Credit Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PLAN ONLY, awaiting owner approval of the design and cross-module M03/M04/M07/M08 schema ownership. Nothing below authorizes product code, a remote migration, feature-flag changes, or a production deployment.

**Goal:** Allow fully paid anonymous walk-in checkout, one-click POS customer creation, walk-in Cash Return without registration, and an audited Store Credit Return that creates/selects and links a real customer to the original invoice without duplicate financial effects.

**Architecture:** Reuse the current compiled source UI, authenticated Owner Worker, per-Shop D1 and existing cash Sale/Cash Return kernel. Preserve immutable sale history; introduce reviewed typed guest/registered attribution and a single SQL-atomic noncash Store Credit return with Customer advance-account posting, sharing the same return quantity limit and original FIFO reversal. The shared M03 owner exclusively implements all D1/schema, Worker and financial-writer changes; the UI lane consumes only the documented contracts.

**Tech Stack:** HTML/CSS/JS compiled Owner adapter, Node.js built-in test runner, Playwright Chromium, Hono Worker, Cloudflare D1/SQLite and original HisabIQ UI reference.

**Spec:** `docs/superpowers/specs/2026-11-21-walkin-pos-customer-store-credit-design.md`

## Global Constraints

- Start from current GitHub `main`, verify PR #888's merged UI files, active PRs, `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, ADR-007, issue #690 and issue #456.
- Do NOT edit `legacy/source/` or the reference `hisabiq_ui`; preserve original DOM IDs and financial actions using a compiled-only Owner patch.
- Registered Customer identity must come from the authenticated Shop D1, not a client name/phone. No auto-merge on name/phone. Cash-paying walk-in has no Party ID, due or ledger account.
- Guest checkout requires `paidAmount=grandTotal` and no unsupported tender; payment amount, stock and Cash Session must be checked **in SQL**.
- Existing `0007` receipts are immutable and require nonempty `customer_phone`; M03 must approve a lossless versioned guest representation **before** implementing guest checkout (no phony public phone).
- Reuse the M03/M07 return quantity/FIFO/original-price guards across Cash and Store Credit; no second uncoordinated correction engine.
- Store Credit is a Customer liability/advance, not Cash Book, Bank Book or Cash Session turnover; do not auto-net unrelated Party roles or Customer due.
- Approval to build is NOT approval for remote Shop D1 migrations, unsupported Customer Due, credit redemption, public RPC or activation flags.
- UI rule: 36px standard controls, touch accessible, bilingual labels, HisabIQ breakpoints **320/390/768/1024/1440**, `/ui-refine-skill` + `/ui-refine-loop` where available, Playwright screenshots and a review of differences.
- All PRs: `/super build → /super qa → /super review`, RED failing test → smallest GREEN → refactor → affected regressions → full GitHub CI, no direct main commit or parallel shared kernel writes.

## Review Focus

1. **Anonymous partial payment:** a forged API request with no Customer ID and `paidAmount<grandTotal` must be rejected with zero D1 writes (Task 2).
2. **Phone ambiguity:** two Customers with the same or similar phone must never auto-link; selection needs explicit user action and server-verifiable ID (Tasks 1, 3, 6).
3. **Return-method racing:** Cash and Store Credit requests against the same remaining unit must not both win; original inventory cannot over-restock and total refunds cannot exceed original payment (Task 5).
4. **Failed/uncertain Store Credit operation:** network timeout, changed payload, deleted/revoked Customer, canceled dialog or duplicate `operationId` cannot create orphan Customer/credit/attachment or double-post (Tasks 5–6).
5. **Mixed-history and wrong tenant:** old paid invoices keep their immutable receipt fields and Cash Return behavior, while Shop B/disabled staff cannot claim Shop A's invoice or Customer credit (Tasks 1, 4, 5, 7).

---

### Task 0 — Coordinate architecture and reserve shared D1 changes

**Files:** Review `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`, `docs/M03_PARALLEL_READINESS.md`, `docs/architecture/ADR-007-unified-party-relationships.md`, `staging-migrations/shop-owner-write/0007_owner_mvp_cash_sale.sql`, `0008_owner_mvp_cash_return.sql`. Track reservation in existing issue #456/#690.

**Interfaces:** Review/approve one current-Shop Customer ID contract and one integrated return amount/lot guard; publish the exact migration name/number before any writer PR.

- [ ] **Step 1:** Recheck latest `main` and open M02–M08 PR file ownership. Confirm no parallel edits to `src/db/**`, Worker routes, shared posting SQL or Shop identity.
- [ ] **Step 2:** Have M03 decide between a verified lossless migration for true blank guest contacts vs an explicitly reserved internal **non-contact** marker. The external API always uses `customerMode:'walk-in'`, `customerId:''`, `customerPhone:''`; no placeholder is shown as contact or matched as a real number.
- [ ] **Step 3:** M03/M08 confirm one **Customer advance/store-credit liability** account and the current-authority/idempotency envelope; M07 verifies shared return limits. Record signed schema and migration ownership in #456.
- [ ] **Step 4:** Freeze tests and payload contracts below as a reviewed integration handshake; no arbitrary production flag or remote D1 write.

### Task 1 — One real Shop-scoped Customer master for Quick Add

**Files:**
- Create (M03): `src/db/m03-owner-customer.js`
- Modify (M03): `src/m03-owner-redemption-worker.js`, `scripts/build-owner-frontend.mjs`
- Test: `tests/integration/m03-owner-customer-workerd.spec.mjs`

**Interfaces:**
- `createOwnerCustomer(scope,{token,ownerSubject,operationId,name,phone}) → {status:'created'|'replayed',customer:{customerId,name,phone}}`
- `readOwnerCustomers(scope,{token,ownerSubject,query}) → {customers:[{customerId,name,phone}]}`
- Authenticated private `GET/POST /api/owner/customers`, with strict payloads and server-side Customer create/read permission. Reuse Party + `Customer` role; zero opening balance.

- [ ] **Step 1 (RED):** Add test: valid Shop A creates one Customer, repeat ID replays, Shop B cannot read or create it, disabled/revoked role cannot write, same-phone records are not silently merged, no Cash Book/advance entry created.
- [ ] **Step 2:** Run `node --test tests/integration/m03-owner-customer-workerd.spec.mjs`; observe expected missing endpoint/implementation failures.
- [ ] **Step 3 (GREEN):** Reuse authoritative Customer/Party account writer if merged; otherwise M03 adds precisely one Shop-scoped customer creation/read path, SQL-time current authority, uniqueness by ID/operation rather than phone, and strict bounded input.
- [ ] **Step 4:** Re-run focused real Workerd/D1 tests; verify no new public RPC, cross-tenant listing or financial posting. Commit on **M03-owned integration branch**.
- [ ] **Step 5:** Peer review by M04 security and M08 account owner before merge.

### Task 2 — Paid walk-in checkout and registered paid Sale attribution

**Files:**
- Modify (M03): `src/db/m03-owner-mvp-cash-sale.js`, `src/m03-owner-redemption-worker.js`
- Create (M03; migration number reserved in Task 0): additive `staging-migrations/shop-owner-write/` Customer attribution/guest representation extension
- Test: `tests/integration/m06-owner-walkin-cash-sale-workerd.spec.mjs`

**Interfaces:** Extend existing `POST /api/owner/pos/sales` payload with `customerMode:'walk-in'|'registered'`, retaining existing sale fields; server derives verified Customer ID/name/phone in `registered` mode. Guest invoice response uses `customerId:''` and no public phone.

- [ ] **Step 1 (RED):** Test no-contact, fully paid Cash walk-in creates invoice but zero Party/AR, due=0 and one Cash Book receipt; guest due/underpayment/split/bank requests fail closed; registered paid invoice resolves correct current-Shop Customer ID, and wrong-shop ID fails.
- [ ] **Step 2:** Run `node --test tests/integration/m06-owner-walkin-cash-sale-workerd.spec.mjs`; verify expected guest-schema/customer-ID failures.
- [ ] **Step 3 (GREEN):** M03 evolves existing SQL-time sale guards and supplies an **append-only** customer-attribution read model without modifying old immutable receipts. Include full data-preservation migration test for prior 0007/0008 rows.
- [ ] **Step 4:** Re-run real Workerd/D1 tests plus `tests/integration/mvp-first-shop-http-lifecycle-workerd.spec.mjs`; commit on M03 branch after schema owner review.

### Task 3 — POS `[+]` Quick Add and walk-in selector (UI)

**Files:**
- Create (M01/M06): `src/ui/owner-pos-customer.js`, `src/ui/owner-pos-customer.css`
- Modify after M03 contract merge: `scripts/build-owner-frontend.mjs` (minimal compiled-only injection, no frozen source change)
- Test: `qa/m06-pos-walkin-quick-customer.spec.mjs`, `tests/m01-owner-pos-source-guard.test.mjs`

**Interfaces:** Existing `#posCustomerName`, `#posCustomerPhone`, `posState.customers` and `#posCompleteBtn`; `POST /api/owner/customers`, `GET /api/owner/customers`; registered selected ID is authoritative. Reset/Clear Customer changes selection only, not cart.

- [ ] **Step 1 (RED):** Playwright asserts `Walk-in Customer` selected by default; 100% paid checkout needs no name/phone; visible accessible `[+]` beside customer picker; quick modal Name + Phone, Save & Select, Enter/Escape, loading/error states; selected ID persists, cart/quantities/payments unchanged.
- [ ] **Step 2:** Run `node --test qa/m06-pos-walkin-quick-customer.spec.mjs`; expect no plus control and old required-field gate.
- [ ] **Step 3 (GREEN):** Add compiled-only HisabIQ-styled controls and Owner API calls. Do not call the original GAS-only `addCustomerChecked` unless its Owner adapter is wired to the same authoritative M03 endpoint. Mobile button remains visible at 320px; no mock/customer cache.
- [ ] **Step 4:** Verify Playwright 320/390/768/1024/1440, keyboard/focus, three states, and original POS source preservation; commit UI-only PR after M03 Customer endpoint is merged.

### Task 4 — Keep the original walk-in Cash Return functioning

**Files:** Existing `src/db/m03-owner-mvp-cash-return.js`, `qa/m03-mvp-cash-return-browser.spec.mjs` (M03/M07 QA owner only).

**Interfaces:** Existing original `completeReturn` Cash method; no Customer registration when `customerId:''`.

- [ ] **Step 1 (RED):** Add a browser test: Guest fully paid Sale without contact → invoice search → partial/full supported Cash Return → one return receipt + FIFO restock + Cash Book refund, no Party or customer-credit entry; second unchanged retry returns original result.
- [ ] **Step 2:** Run `node --test qa/m03-mvp-cash-return-browser.spec.mjs`; observe missing guest-sale case as failing acceptance.
- [ ] **Step 3 (GREEN):** Only adapt the smallest Cash Return read/validation needed to recognize the typed guest Sale; preserve 0008's original-price, same-day, whole-unit and Cash Session constraints unless separately approved and tested.
- [ ] **Step 4:** Re-run all Cash Return and Sale detail/readback suites; commit to M03/M07-owned path, no speculative extension to multi-item/history.

### Task 5 — One atomic Store Credit Return + original invoice attachment

**Files:**
- Create (M03 shared integrator): `src/db/m03-owner-store-credit-return.js`
- Modify (M03 only): `src/db/m03-owner-mvp-cash-return.js`, `src/m03-owner-redemption-worker.js`, shared Owner D1 return constraints and the reserved additive Customer-advance extension from Task 0
- Test: `tests/integration/m07-owner-store-credit-return-workerd.spec.mjs`

**Interfaces:** Existing private `POST /api/owner/returns` plus `refundMethod:'Store Credit'` and `customerResolution:{mode:'create',name,phone}|{mode:'existing',customerId}` for **unregistered** original invoices. Customer ID is implicit and verified for already registered invoices. Immutable result: `{returnId,invoiceId,customerId,totalReturnAmount,creditPaisa,availableCreditPaisa}`. Stable `operationId` persists on retries.

- [ ] **Step 1 (RED):** Real two-Shop D1 tests assert successful guest create+invoice attach+return+credit, zero Cash/Bank movement, correct FIFO restock/sales profit, exact liability; duplicate operation replays without new customer; concurrent Cash+Credit over-return is rejected; wrong Shop/staff/customer/credit amount fails.
- [ ] **Step 2:** Run `node --test tests/integration/m07-owner-store-credit-return-workerd.spec.mjs`; verify expected missing Store Credit support.
- [ ] **Step 3 (GREEN):** M03 integrates Store Credit into the single source-of-truth return ceilings and Money/FIFO guards; add append-only **Customer attribution and credit-ledger source links** in **one D1 atomic write**, including any new customer creation. Do **not** invoke the Cash Return trigger for noncash returns and do **not** silently change historic 0008 receipts.
- [ ] **Step 4:** Failure-injection before/after each atomic step; verify zero orphan Party, credit, return, invoice claim or inventory write on failure, and correct guarded replay; re-run Cash Return regression.
- [ ] **Step 5:** Get M07 original-lot reviewer + M08 Customer liability sign/direction + M04 current-authority review before merging the protected M03 PR.

### Task 6 — Return method dialog and exact customer binding UX

**Files:**
- Create (M01/M07): `src/ui/owner-return-store-credit.js`, `src/ui/owner-return-store-credit.css`
- Modify: `scripts/build-owner-frontend.mjs` compiled Owner adapter only, after M03 response contracts are approved
- Test: `qa/m07-walkin-store-credit-browser.spec.mjs`

**Interfaces:** Existing `#rtRefundMethod`, `#rtCompleteBtn`, `rtState.invoice`, original `runConfirmedAction`; source invoice `customerId` from authorized read response; same idempotent Owner `completeReturn` call.

- [ ] **Step 1 (RED):** Playwright: Cash → no popup, full return succeeds; Store Credit on guest → blocking dialog Name/Phone or explicitly select existing; missing fields and duplicate-match ambiguity cannot submit; Cancel → zero POST; confirm → one actual Store Credit POST, success links invoice and Customer.
- [ ] **Step 2:** Run `node --test qa/m07-walkin-store-credit-browser.spec.mjs`; expect no dialog/backend denial.
- [ ] **Step 3 (GREEN):** Add accessible compact modal with bilingual hints, current invoice number and exact credit amount, progress/no duplicate click, retry unchanged operation ID. Show backend-denied state rather than promising a credit receipt. Do not mutate original Cash action or reveal unsupported credit options.
- [ ] **Step 4:** Run reference screenshot/refinement at 320/390/768/1024/1440, with focus, long names, duplicate phone, cancel, network failure and financial confirmation. Commit UI PR independently.

### Task 7 — Sales History, Customer Ledger and Return readback

**Files:**
- Modify by owning M03/M08 integrator: `src/db/m03-owner-mvp-cash-sale.js`, Owner Customer read model, existing Owner Worker `GET /api/owner/sales` and invoice detail, original Customer compatibility reader
- Test: `tests/integration/m08-owner-store-credit-ledger-read-workerd.spec.mjs`, `qa/m07-walkin-store-credit-browser.spec.mjs`

**Interfaces:** `GET /api/owner/sales/:invoiceId` returns original invoice plus explicitly linked Customer ID/Store Credit return references, `GET /api/owner/customers/:customerId/ledger` returns immutable credit ledger and available liability. Existing `getCustomerDetail` RPC compatibility must be real or intentionally unavailable.

- [ ] **Step 1 (RED):** Test Cash refund vs Store Credit distinguish correctly in Sale/detail/history; linked Customer ledger shows `Invoice INV-...`, `Return SRT-...`, `+৳credit`, with unchanged Cash Book; existing Shop B has zero entries; opening balance remains zero.
- [ ] **Step 2:** Run focused Store Credit ledger read integration test and observe missing data.
- [ ] **Step 3 (GREEN):** Reuse M08's sole Customer advance ledger and M03's receipt projections; one authoritative source-based read, no invented net due, no second Customer accounting table. Render traceable credit with explicit `Redeem` **disabled** until M06 future-sale credit tender is separately integrated and tested.
- [ ] **Step 4:** Re-run all Sales/Return/Customer/Daybook/Profit reconciliation tests, including legacy historic paid receipts; commit after M08 sign-off.

### Task 8 — Whole-journey QA, review and release boundaries

**Files:** `qa/m06-pos-walkin-quick-customer.spec.mjs`, `qa/m07-walkin-store-credit-browser.spec.mjs`, `qa/m03-mvp-cash-return-browser.spec.mjs`, `docs/reviews/` evidence and owning PR descriptions.

- [ ] **Step 1:** Run RED/GREEN evidence for each prior task; no green claimed on skipped/fixture-only writes.
- [ ] **Step 2:** Run `node --test` for all new integration/browser suites, plus existing `qa/m03-first-shop-complete-journey-workerd-browser.spec.mjs`, `tests/integration/mvp-first-shop-http-lifecycle-workerd.spec.mjs`, `tests/integration/m10-operational-owner-sale-parity-workerd.spec.mjs`.
- [ ] **Step 3:** Run `npm run build:owner-frontend`, `npm run verify:source`, `npm run docs:check`, and affected full repository tests; no mismatched authentication or frozen source regressions.
- [ ] **Step 4:** Screenshot the real compiled UI before/after at 320/390/768/1024/1440; run `/ui-refine-skill`, `/ui-refine-loop` and Playwright visual comparison if installed, otherwise document unavailable gates and manual visual inspection; verify no horizontal overflow or dialog clipping.
- [ ] **Step 5:** Run two-Shop real D1 tests with revoked staff, concurrent Cash+Credit return, partial return, replay, simulated uncertain network response and exact stock/Cash/Customer liability conservation. Get M03/M04/M07/M08 review.
- [ ] **Step 6:** Verify all exact-head GitHub PR checks green and no conflicts; merge in dependency order, independently confirm merged SHA on main.
- [ ] **Step 7:** Only after **separate** authorized release: verify Cloudflare Worker version/immutable Shop bindings, approved D1 migrations/backups, production flags, authenticated POS/Customer/Return smoke, and rollback readiness. No automatic deployment, remote SQL or financial switch from a planning-only PR.

## Planned merge order and dependencies

1. **M03 Customer master contract** (Customer role, scoped authenticated list/add, clean D1 test).
2. **M03 Walk-in cash-sale/attribution** (guest schema decision and original cash guard).
3. **M01/M06 POS Quick Add UI** + **M07 Cash Return guest regression**.
4. **M03/M07/M08 Store Credit atomic ledger** (source-linked Customer liability and mixed-refund quantity guards).
5. **M01/M07 Return dialog** and **M08 Customer Ledger readback**.
6. **M10/M11 security, finance, release review**, then separately approved production deployment.

**Not an automatic part of this request:** multiple payment methods, due walk-in, arbitrary multi-item historical returns, Bank refund, Store Credit redemption as future-sale tender, migration of existing unnamed historical invoices en masse, silent phone-based customer merging or unconditional Cloudflare production enablement. Those require their own approved interfaces and tests.

## Plan self-review / approval checkpoint

- Spec coverage: walk-in fully paid only (Tasks 2–3); POS `[+]` (Tasks 1,3); walk-in Cash refund (Task 4); guest→Customer Store Credit dialog/link (Tasks 5–7); D1, security and QA (Tasks 0–2,5,8).
- Financial invariant tests: Cash vs Credit exactly-once, cross-Shop isolation, original receipt immutability, Customer advance accounting, no Cash Book on credit, stock limits and idempotent retry all explicitly assigned.
- Owner decisions needed **before coding:** approve design B, including the explicit Customer creation/selection dialog and **Customer store-credit liability separate from due**. M03 must reserve and approve any D1 migration/guest contact representation.
- On owner approval, follow `superpowers:executing-plans` or `superpowers:subagent-driven-development` as assigned. Do not implement based only on this plan branch.
