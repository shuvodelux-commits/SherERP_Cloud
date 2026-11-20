# M01 — POS V2 discount, partial due and change preview regression

**Date:** 2026-11-20; **Issue:** #768; previous merged #761.  
**Base:** `main@e81e243b94ff7712ae6c42392ae4fc4c763faf8d`.  
**Pinned original source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Branch:** `m01/posv2-discount-due-change-preview-20261120`.

## Superpowers implementation overview

1. Previous M01 original-source browser PRs protect navigation, authentication filtering, Drafts, product selection, quantity edits, drag reorder and FIFO-price display.
2. Remaining high-value UI financial feedback concerns discount, received cash, customer due and change presentation before checkout.
3. The original `posRecalcTotals_` and `posDeriveSaleTerms_` functions update the screen in direct response to the source Discount and Amount Received input controls.
4. These are **display-only calculations** and must not be confused with server-authoritative financial posting or approved real checkout.
5. This test creates one synthetic standard product in an isolated Chromium tab with source lot fallback price of exactly ৳49.99 and quantity two.
6. It uses the preserved original compiled frontend and the M01 authenticated synthetic Clerk navigation fixture, not a replacement POS implementation.
7. The test runs phone 390×844, tablet 768×1024 and desktop 1280×800 viewports, switching the phone to the actual Payment tab.
8. The source product gives subtotal ৳99.98, and discount ৳0.03 should yield grand total ৳99.95.
9. Empty or zero Amount Received must display full Due, while receiving ৳40 must display exactly ৳59.95 remaining Due.
10. Receiving exactly ৳99.95 must hide both change and due; receiving ৳120 must display Change Due exactly ৳20.05.
11. Increasing discount to ৳10.05 should update grand total to ৳89.93 and Change Due to ৳30.07 without altering cart quantity.
12. Discount above subtotal must clamp grand total to zero rather than show negative cash due, and no source sale/draft/payment/ledger writing RPC may be invoked.
13. Screenshot evidence captures the partial-Due and change phases without real customer data, production D1 bindings or financial transactions.
14. Only this M01 regression test and its plan may change; shared Cloudflare, source ERP, M03/M05/M06/M08 and integration files remain protected.

## TDD, scope and release gates

Write only `qa/m01-landscape.spec.mjs` (append), and this new M01 plan. Read-only: existing browser fixtures, original compiled source, `AGENTS.md`, parallel readiness and current open PR ownership. Do not alter UI source to coerce tests; the original currency formatter may omit trailing decimal zeros. A real regression requires preserving RED evidence and obtaining source-owner coordination, while an inaccurate test expectation can be corrected entirely in M01.

Require /super build → /super qa → /super review, exact-head Chromium and full CI, no pending/failed required checks and independently recorded review. Cloudflare Workers Builds failure existing on previous main is a distinct M11 investigation, not grounds for bypassing merge protection. New PR stays **draft, unmerged pending explicit owner approval**.

**Rollback:** remove added test and plan only; no production behavior or customer data changes.
