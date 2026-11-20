# M08 Run 3 — exact-decimal arithmetic proposal and technical sign-off

**Date:** 20 November 2026 (Asia/Dhaka)
**Scope:** Proposal + test-only arithmetic and local Workerd/D1 proof, NOT an ERP financial posting implementation.
**Authoritative source:** frozen Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Base:** SherERP_Cloud `main@15f18b55b59a6b3964d92dd9f1ad07d39662a0da`.
**Owner-approved POLICY:** [M08 #66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66#issuecomment-7030515664); M02 account separation [#24](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24#issuecomment-7030518305); integration gate [M03 #22](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/22#issuecomment-7030521583).
**Exact NUMERIC SPEC:** **PROPOSED, NOT YET OWNER/M08 TECHNICALLY SIGNED.** No source/history/backfill rewrite; no deployment, operational SQL, public RPC or financial posting.

## 1. Implementation overview (12 sentences)

1. Preserve raw source-entered decimal strings for quantities, costs, prices and discounts instead of converting to IEEE-754 Number.
2. Convert those strings to reduced BigInt fractions, with exact multiplication across quantities, prices and reviewed unit conversion ratios.
3. Keep fractions through invoice aggregation and proportional discount distribution.
4. Require an explicit rounding mode on every operation, never a silent default.
5. Only after exact computation propose conversion to integer BDT minor units for a money-book/ledger header and its line allocations.
6. Allocate the header's whole paisa across line nets using the deterministic largest-remainder method and immutable line ID tie-breakers.
7. Retain the frozen source's zero floor on excessive purchase discounts in this **non-posting comparison quote**, rather than silently claiming the owner approved stricter discount rejection.
8. Adjust an eligible **new-business** supplier's final partial return to reconcile the original line allocation, while flagging a last-return adjustment above one paisa for manual accounting review.
9. Restrict new-shop Cash refunds to verified net money previously collected, net of earlier attributable cash refunds; any remaining return entitlement is a **proposed** Store Credit amount, not a posted Customer ledger entry.
10. Cross-check the M08 proposal against M05's existing exact Tiles Pcs, Box, Sqft and manufacturer-coverage arithmetic.
11. Exercise the same pure calculation in a local isolated Workerd and use disposable D1 tables solely to prove integer amount conservation, rollback, duplicate quote protection and two-shop identity separation.
12. All supplier identity checks, current-actor authority, Cash Session enforcement, true tender backing, source-lot FIFO, stock, actual ledgers, security and operational SQL still belong to the separate signed M02/M03/M04/M05/M07/M08 integration gates.

## 2. Numeric contract — candidate for technical approval

| Parameter | Proposed Run 3 limit / behavior | Reason / unresolved |
|---|---|---|
| Input text | Strict ASCII canonical decimal strings; no sign for quantities/prices/discounts, optional sign only in signed arithmetic probes; no whitespace, group separators, exponents, leading zeros, negative zero or JS numeric inputs | Avoid lossy float coercion and ambiguous transaction intent |
| Quantity/price digits | Up to **12 digits before** decimal and **12 digits after**, but **quantity ≤1,000,000,000** and **unit price ≤৳1,000,000,000** | These maxima are conservative candidates, **not final approved business limits** |
| Unit/Tiles ratio | Positive exact numerator and denominator, up to **36 decimal digits each**; product and measurement revisions must be independently authenticated | Needed for rational cm/mm/Tiles conversions; no implicit 1 Box = N Pcs assumption across products |
| Exact intermediates | Arbitrary-precision reduced BigInt rational objects; raw lexeme retained | Preserve `0.5 × 10.005 = 5.0025` BDT, and record the exact original lot cost for future audit |
| Minor units | Whole paisa (100 = 1 BDT), returned as **strings**, absolute rounded amount ≤ **9,007,199,254,740,991 paisa** (JS safe integer); no SQLite REAL | Guard overflow before D1 INTEGER bindings; any SQL `SUM` must independently stay within signed 64-bit limits |
| Rounding mode | **HALF_UP (ties away from zero)** and **HALF_EVEN** both implemented/tested, **no implicit choice** | Proposed M08 recommendation for new BDT cashbook: HALF_UP; owner/M08 must explicitly select one mode and exact conversion boundary before operational SQL |
| Line conversion | Compute `exact physical qty × exact unit price`, then round for **display/proposal only** | Do not round raw stored lot cost; do not price on 2-decimal displayed Sqft or subtotal |
| Invoice discount | Exact per-line gross sum; `grand = max(0, subtotal - discount)`; proportional exact net to each line; round **one header** to paisa; allocate remainder by greatest fractional part, ties by immutable ASCII line ID | Source preserves excessive discounts with zero floor; stricter UI validation needs a distinct owner change |
| Invoice size | **1–200 unique immutable ASCII line IDs**, each original line and rounded subtotal within safe minor bound | Narrow reference proposal; a different retail max needs evidence and explicit approval |
| Cash collected | Inputs to refund checker are canonical **integer-paisa strings**; cash refund ≤ min(returnable entitlement, verified net-collected minus prior refunded) | M03 SQL must verify invoice ownership/collections/chargebacks/previous refunds atomically, not trust caller snapshots |
| Final supplier return | Normal per-return rounded share except final eligible quantity receives remainder; **difference above one paisa fails closed for review** | Approved principle, **1-paisa safety threshold remains a technical candidate**, not general proof across many microscopic partial returns |
| Negative debit/credit | Signed rounding probe preserves sign; monetary posting must maintain account-specific debit/credit and no automatic cross-role netting | Signed zero normalizes to `0`; negative source prices cannot sneak into retail quote |
| Historical records | Keep source precision and **original** cash-return/partial-return semantics in immutable provenance | Never impose new-business policies retroactively or recalculate old ledger entries silently |

### Calculation examples (explicit HALF_UP selection only for candidate)

- Fractional new purchase: `0.5 × 10.005 = 5.0025` BDT exact; optional whole-paisa posting quote **500** paisa; original cost `10.005` stays unchanged.
- Tie case: `0.005` BDT → HALF_UP `1` paisa; HALF_EVEN `0`; `-0.005` → HALF_UP `-1`, HALF_EVEN `0`. **Tie policy not yet signed.**
- Three undiscounted lines `0.335` BDT: exact header `1.005`, HALF_UP header `101` paisa, deterministic allocation ID A/B/C `34/34/33`. HALF_EVEN would allocate `34/33/33` for total `100` paisa.
- Original discounted supplier item total `100` paisa for 3 units: first returns `33,33`, final remaining `34`; **no** historical source row rewritten.
- Unpaid Customer return entitlement `7500` paisa with `0` verified collections → allowed cash payout `0`, remaining eligible `7500` suggested for authorized Store Credit/AR treatment; no automatic Customer due write.

## 3. TDD and QA evidence

**RED:** Commit adds standalone tests before `src/modules/m08-exact-decimal-proposal.js` exists, and `node --test tests/m08-exact-decimal-proposal.test.mjs` fails on missing module (source untouched; genuine missing reference implementation).
**GREEN:** Add isolated proposed pure M08 implementation with canonical strings, BigInt rationals, explicit mode, deterministic invoice apportionment, supplier final-return cap and refund ceilings.
**Refactor/safety:** Fail closed on ambiguous input, rationals outside bounds, duplicate line IDs, accessor-bearing records and oversized last-return correction; test no input mutation.
**QA:** Deterministic randomized 500 invoice cases + 300 refund conservation cases, direct M05 Tiles unit and manufacturer comparisons, local Workerd calling the same module, separate disposable synthetic D1 INTEGER quote conservation/rollback.
**Real operational proof NOT claimed:** Test-only D1 quote tables and local Workerd endpoint are isolated from app Workers, have **no authenticated transactional finance writer**, and do not establish correctness of future purchase/sale/return SQL or private historical books.

### Files owned exclusively by M08 Run 3

- `src/modules/m08-exact-decimal-proposal.js` — internal standalone pure calculator, not imported by production Worker/RPC.
- `tests/m08-exact-decimal-proposal.test.mjs` — pure RED/GREEN numeric contract.
- `tests/fixtures/m08-exact-decimal-probe-worker.mjs` — isolated local QA Worker.
- `tests/integration/m08-exact-decimal-workerd.spec.mjs` — local D1 quote-only batch/rollback proof.
- `wrangler.m08-exact-money-test.jsonc` — **test-only**, no remote database ID or production account.
- `.github/workflows/m08-exact-money-proposal-workerd.yml` — PR-only, no secrets, no deployment; validates source and Workerd.
- This plan file.

No changes to Control Center PR #722, `src/db/**`, shared migrations, `src/rpc/**`, public/main Worker, installed account resources or historical source.

## 4. Review / decision gates before any operational monetary SQL

- [ ] **Owner + M08 technical sign-off:** exact scales/ranges, 12 fractional digits and 36-digit ratio bound, line count, price/quantity cap, HALF_UP versus HALF_EVEN tie policy, invoice header versus per-line posting boundary.
- [ ] **Owner + M08 adjustment sign-off:** confirm final supplier-return adjustment above one paisa is held for manual review (or approve a separately tested cumulative allocation alternative). Prove partial, corrected and returned-after-cancel scenarios.
- [ ] **Owner + M08 refund sign-off:** source-collected/returned evidence defines verified net collections and per-invoice cash refund ceiling, including split tender, chargebacks, Store Credit, account AR behavior and atomic replay.
- [ ] **M02 #24:** reviewed original Supplier ID and Party account link provenance for historic cutover; distinct clean new-shop Supplier ID issuance without name/phone guessing.
- [ ] **M03/M04 exclusive integrator:** next versioned D1 schema, SQL-time Shop/actor/permission/Cash Session authority, idempotent immutable receipt and journal allocation, concurrent stock/lot version guards, no double posting and failure-injection rollback.
- [ ] **M05/M06/M07:** compare approved shared rounding with their existing per-line M05 Tile, POS, split tender and return correction calculations before live ERP activation; no independent second monetary posting engine.
- [ ] **M10/M11:** separate private historical reconciliation and Cloudflare deployment/recovery approvals.

**Merge of this PR (after Super QA and Super Review) only makes an internal reference proposal and test evidence available; it does NOT constitute the technical sign-off above or enable a hosted financial writer.**
