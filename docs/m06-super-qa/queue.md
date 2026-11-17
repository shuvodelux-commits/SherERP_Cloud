# M06-only Super QA acceptance queue — 2026-11-17

**Primary evidence:** [audit-2026-11-17.md](audit-2026-11-17.md)  
**Tracked scope:** #314; coordination #456. **Not** the global Super Board `docs/super-qa/queue.md` (not installed/onboarded here). This M06-only queue never modifies shared M01/UI or M03/posting files.

## Wave A — currently evidenced as existing GitHub regression cases

- [x] A01 — Source parity for exact paisa, split cash/bank/mobile, change and zero-child due; `tests/m06-sale-payments.test.mjs`.
- [x] A02 — Mixed-unit single logical sale line with base-stock FIFO and owner/vendor/negative shortage; `tests/m06-multi-unit-pos-line.test.mjs`.
- [x] A03 — Multi-line mixed-unit preview and exact tender header; `tests/m06-mixed-unit-pos-checkout-preview.test.mjs`.
- [x] A04 — Tiles Box/Pcs/Sqft area/price/revision mathematical evidence; `tests/m06-tiles-checkout-preview.test.mjs`, `tests/m06-tile-checkout-evidence-audit.test.mjs`.
- [x] A05 — Historical snapshot corruption, FIFO coverage, duplicate IDs and payment header consistency; `tests/m06-sale-checkout-snapshot-audit.test.mjs`.
- [x] A06 — Legacy draft must reject hidden unit/Tiles snapshot loss; `tests/m06-legacy-draft-loss-guard.test.mjs`.
- [x] A07 — Draft owner/version rules, read models, split-correction preflight and printed invoice projection; `tests/m06-draft-*.test.mjs`, `tests/m06-posted-invoice-read-model.test.mjs`.
- [x] A08 — Synthetic Workerd/D1 posting rollback, Cash change, Party direction and replay; `tests/integration/m06-sale-posting-workerd.spec.mjs` (**synthetic only**).
- [x] A09 — M01 compiled original POS V2 visibility across 320, 768 and 1280px with mocked auth; `qa/m01-posv2-compiled-visibility.spec.mjs` (**not real checkout**).

## Wave B — production integration and end-to-end paths: not proven

- [ ] B01 — Authenticated tenant-scoped POS login + `completeSale` RPC, denied/stale/revoked/disabled user and role gates. M04/M03 dependency; **must remain fail-closed**.
- [ ] B02 — Open Cash Session required for sale per approved settings, including all-Due and close race. M03/M08 dependency.
- [ ] B03 — Real D1 single atomic sale: invoice ID + Sale Items + FIFO lots + vendor costs + cash/bank + customer AR and distinct Supplier ledger. M03/M05/M08 dependency.
- [ ] B04 — Concurrent last-item and duplicate/lost-response idempotency against real shared tables, with forced failure-injection at each stage. M03 integrator.
- [ ] B05 — Real multiunit/Tiles historical snapshot persistence, billed Sqft exactness and old revision replay. M03/M05/M06 dependency.
- [ ] B06 — Authorized Saved Draft save/edit/consume/void, including versioned unit-aware draft and no snapshot loss. M03/M04/M06 dependency.
- [ ] B07 — POS V2 end-to-end happy and failure paths on phone/tablet/desktop, screenshot + console + network/HAR evidence, real auth; M01/M06.
- [ ] B08 — A4/thermal invoice for original posted sale and split/partial/return edits; M01/M09 and M07.
- [ ] B09 — Original-lot return/edit/delete one-effect reversal, refunds, historical factor frozen, ledger balance parity; M07.
- [ ] B10 — Cross-module D1 actor/Party ID mapping, genuine source migration, security review and recovery/production test gates; M02/M04/M10/M11.
- [ ] B11 — Full external Super Board `/super-qa` 10-iteration Playwright BFS: install/onboard authorized host, set QA project/route seed, run on **staging only** with synthetic credentials; not executed via this ChatGPT GitHub audit.

## Severity and handoff

**Critical release holds:** B01–B06, B09, B10. **Test-evidence gap:** B07/B08/B11. Do not relabel a documented integration dependency as a fresh bug or close #314 merely because Wave A tests are green. Keep shared D1/RPC and CI config ownership with M03/M11; all changes through reviewed PRs.
