# M07-B8 — Store Credit Sales Return Price-Only Edit (isolated D1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and test-driven-development to perform RED → verified failure → GREEN → full CI verification.

**Goal:** Reconcile a *price-only* Store Credit Sales Return correction with the original Customer's signed due/advance, without changing physical stock, another Party account, original invoice, or immutable history.

**Architecture:** Reuse merged M06 original sale, M07 signed Store Credit return, B3 Store Credit delete, and B6 edit-version fixtures in an isolated Workerd/D1 test. Preserve immutable original return and ledger; add a separate source-linked append-only correction receipt and Customer debit/credit adjustment ledger. One guarded D1 INSERT and AFTER INSERT trigger must atomically reserve the version, update only the reviewed Customer role's signed account, and append exactly one audit row. Disallow later unrelated Customer ledger entries, explicitly dependent settlements, closed Cash Sessions and historical ambiguity.

**Tech stack:** Node ESM tests, Wrangler real local Workerd/D1 (separate synthetic database), GitHub Actions, frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `SalesReturn.gs::prepareSalesReturnChange_` / `updateSalesReturn`.

## Module overview (13 sentences)

1. The source ERP permits a price-only edit of a Sales Return while retaining the same source invoice, Return ID, quantity and lot restoration.
2. Changing only Store Credit value must not change the physical product stock, original sale or original return movement.
3. The original Store Credit receipt and Customer credit ledger remain immutable and available to audits.
4. The new effective credit amount is represented by the latest versioned correction, not a second original return.
5. Decreasing Store Credit debits the same Customer's signed due/advance account by the difference.
6. Increasing Store Credit credits that same Customer signed due/advance account by the difference, potentially creating an advance.
7. The source Customer's reviewed Party link and original signed Store Credit ledger must be verified inside the atomic SQL write.
8. A later Customer ledger entry, dependent settlement marker or unexpected current signed balance blocks a correction pending reconciliation.
9. Cash and Bank entries, Supplier, Vendor, Owner, Lender and Borrower accounts remain entirely untouched.
10. The current Cash Session must be open, the source return must not have been deleted, and expected edit version must match exactly.
11. Stable operation IDs bind source, actor, expected version, old amount, new amount and edit reason; concurrent stale changes cannot both commit.
12. Any trigger failure rolls back the receipt, new balance, edit version and adjustment audit together, while preserving all original records.
13. This is strictly a synthetic local D1 proof; live M04 authentication, M08 settlement allocation and full original ERP UI/RPC parity remain separate launch gates.

## Task 1 — RED acceptance test and isolated tables

- [ ] Add `tests/fixtures/m07-credit-price-edit-schema.mjs`: immutable correction and adjustment ledger, dependency markers, active effective Credit read view and DB-enforced version/account atomic trigger; guard legacy deletion after a price correction.
- [ ] Add `wrangler.m07-credit-price-edit-test.jsonc`: isolated Workerd D1 binding with a unique local-only UUID, no public route.
- [ ] Add `tests/integration/m07-credit-price-edit-workerd.spec.mjs`: source sale/credit seed, 13+ real D1 cases with no Cash/Bank/stock mutation, debit/credit polarity, negative Customer advances, version sequencing, replay/conflict/concurrency, tampering/Party drift, later credit/settlement, closed session, source deletion and fault rollback.
- [ ] Add one aggregate import in `tests/integration/m03-workerd.spec.mjs` so the same CI runs all Workerd/D1 regression cases.
- [ ] Commit tests before implementation and confirm the *expected missing-contract* RED failure in actual GitHub Actions; fix malformed RED tests if necessary before GREEN.

## Task 2 — GREEN and verification

- [ ] Add `tests/fixtures/m07-credit-price-edit-contract.mjs` only after observed RED. Export `createSyntheticD1CreditPriceEditContract(DB,{beforeBatch}={}).post(raw)`.
- [ ] Strict exact shape plus safe integer validation; canonical SHA-256 operation fingerprint; SQL source invoice, original return/lot/movement, Customer signed account, reviewed Party and current revision guards; immutable receipt and signed delta journal in one D1 batch.
- [ ] Expose `COMMITTED`, `REPLAY`, `CONFLICT`, `DECLINED` or `NEEDS_REVIEW` without pretending a noncommitted uncertain write can be retried with a fresh operation ID.
- [ ] Verify exact-head GitHub Foundation suite, source build, all actual local Workerd/D1 tests, UI smoke and PR preview isolation.

## Task 3 — PR and release gates

- [ ] Record RED/GREEN SHAs, Workerd job logs, current CI outcomes, outstanding gates and rollback scope in the draft PR; owner reviews before merge.
- [ ] Do not modify `src/**`, `src/rpc/**`, `migrations/**`, `legacy/source/**`, original HTML/CSS/JS, production Cloudflare D1, real Sheets, or existing public Worker.
- [ ] Full M04 `returns:edit` authorization, original historical Cash Session and source journal semantics, M03 shared posting transaction owner, M02 original-ID import, M05 bundles/FIFO/vendor/OVERSOLD, M06 split payments, M08 real Customer settlement/advance allocation, M09 native Return History/Day Book/print and business cutover remain blocked.

**Notes:** This proof does not mutate original M06 Customer due, which remains a nonnegative synthetic posting ledger; M07 signed Customer account is the only credit/advance balance used here. The source's native correction replaces a Return row; this proof appends immutable versions and needs a coordinated active read view before production. Never infer entitlement from client-supplied actor or Party role.
