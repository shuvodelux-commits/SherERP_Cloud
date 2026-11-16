# M06 historical payment catalog replay — Superpowers TDD plan

> **For agentic workers:** Execute test-first on an isolated GitHub branch; use Superpowers TDD and exact-head GitHub Actions. Review this plan with its design spec.

**Goal:** Reconcile same-operation replay against immutable posted payment details rather than mutable current Bank/Mobile account metadata.

**Architecture:** Extend the already tenant+operation-scoped `SQL_LOOKUP` invoice query to return its original `payments_json` for historical same-actor operations. The preflight normalizer uses catalog rows derived from that saved JSON **only** for historical replay, then validates canonical hash and every posted child through `verifyReplayReceipt`. New operations still read `SQL_ACCOUNTS`, and the atomic D1 insert guard is not touched.

**Tech stack:** Node ESM, existing `normalizeSalePayments_`, GitHub CI, isolated Cloudflare Workerd/D1 fixtures.

**Spec:** `docs/superpowers/specs/2026-11-16-m06-historical-payment-catalog-replay.md`

## Global constraints
- Source SHA `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. No source GAS, production DB/schema, `src/`, public RPC, UI, auth or deployment changes.
- No bank account creation, financial writes or authorization derived from historical input. Immutable prior evidence does not authorize future sales.
- Keep original operation, actor, hash, stock/session/Party and child receipt rules intact.
- One objective per PR; leave draft for owner review after verified GREEN.

## Review focus
- Deleted historical Bank/Mobile account: clean replay, zero new posting.
- Reclassified historical Bank account: clean replay, zero new posting.
- Tampered amount or actor: conflict; never replay.
- Missing/extra posted Bank Book or payment child: NEEDS_REVIEW.
- Fresh sale against missing or wrong-type catalog entry: reject.

### Task 1 — Original catalog-independent receipt replay

**Files:** `tests/integration/m06-sale-posting-workerd.spec.mjs`, `tests/fixtures/m06-sale-posting-contract.mjs`.

**Interfaces:**
- Consumes: `createSyntheticD1SalePostingContract(DB).post(input)`, `SQL_LOOKUP`, `normalizeSalePayments_`, `hashCanonicalOperationIntent`, `verifyReplayReceipt`.
- Produces: existing `post()` statuses unchanged; historical replay independent of current bank master.

- [ ] Test-first commit: add separate archived-account and reclassified-account real Workerd/D1 tests, plus preserved blocked new sales and conflict checks. Use `snapshot()` before and after retry.
- [ ] RED check: run exact test-only GitHub M03 real local Workerd/D1 workflow. Expected new tests fail for missing account and changed account type; unrelated tests remain green.
- [ ] Minimal GREEN: query `payments_json` from existing prior posted invoice, map trusted historical `Bank`/`Mobile Banking` account ID+type solely for same-actor replay, handle malformed source record as NEEDS_REVIEW; leave new-sale current-catalog normalization and SQL authority unchanged.
- [ ] Verify exact-head GREEN GitHub checks (M03, Foundation, M04, M07 regression, M01 and preview safety). Record test counts.
- [ ] Open/refresh draft PR with file inventory, observed RED/GREEN, CI links and explicit production migration blockers.
