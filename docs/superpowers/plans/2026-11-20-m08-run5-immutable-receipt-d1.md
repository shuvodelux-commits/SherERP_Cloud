# M08 Run 5 — immutable allocation receipts and refund backing (isolated local D1)

**Date:** 2026-11-20 (Asia/Dhaka)
**Base:** `main@872ca8560906afe9dfd2ee8e7e8e80be4a597158` after merged #722/#726/#727/#728.
**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
**Workstream:** M08 #66, with M02 #24, M03 #22, M04 #23 and coordination #456.
**Status:** **TEST-ONLY PROPOSAL**, not owner-signed technical rounding policy, source reconciliation, shared migration or an operational posting authorisation.

## Implementation overview (12 sentences)

1. M08 Run 4 showed real disagreements between legacy per-line rounding and the proposed exact invoice-header rounding.
2. Run 5 therefore tests a single immutable invoice allocation receipt as the link between those calculations and eventual payment/return flows.
3. The test builds a candidate invoice through the already merged pure M08 exact-decimal proposal and explicitly supplies HALF_UP only for its fixtures.
4. It reuses the original M06 split-payment helper for Bank and Cash application rather than constructing another payment algorithm.
5. A disposable D1 header retains the Shop, invoice, operation identity, explicit rounding mode, SHA-256 intent fingerprint, whole-paisa grand and outstanding amount.
6. Each disposable D1 line retains its original quantity and unit-price text alongside the exact allocated whole-paisa amount.
7. A disposable D1 receipt seal enforces that line allocations sum to the header and applied payment legs plus outstanding amount sum to the same header.
8. Once sealed, the fixture blocks further header, line, tender and seal mutations and blocks any attempted post-seal inserts.
9. The operation identity is unique per Shop, same-intent retry reads the same receipt and a changed-intent replay fails.
10. Return fixtures read the stored line allocation, reject over-returns and guard total cash refunds against actual applied money legs already recorded for that invoice.
11. Local Workerd/D1 tests exercise late-batch rollback, concurrent duplicate requests, concurrent cash refunds, two-Shop ID independence, and public RPC absence.
12. This isolated accounting proof deliberately does **not** authenticate a real M04 actor, change real stock, adjust Party AR/AP, perform fiscal reversals, establish the approved monetary tie/scale, or activate any tenant's finance writer.

## Exclusive file list

- `tests/integration/m08-immutable-receipt-workerd.spec.mjs`: real local Workerd/D1 acceptance.
- `tests/fixtures/m08-immutable-receipt-local.mjs`: disposable D1 tables and synthetic SQL rules; **test-only**, not an actual migration.
- This M08-owned plan.
- `.github/workflows/m08-immutable-receipt-local-d1.yml`: new PR-only, nondeploying M08 test workflow, coordinated as isolated CI. No editing M11/shared existing workflows.

**No edits:** `src/db/**`, production `migrations/**`, `staging-migrations/**`, `src/rpc/**`, Worker source, `wrangler*.jsonc`, real M03 provisioning, tenant/Party/auth code, legacy source, UI or financial ledger code.

## Acceptance cases

| ID | Local-only D1 invariant |
|---|---|
| R5-01 | Two `1 × ৳0.335` lines persist **67 paisa** with immutable allocations `34,33`, Bank `25`, Cash `42`, change `8`; no phantom cash movement |
| R5-02 | Same Shop/operation/intent replay reads unchanged receipt; changed intent conflicts |
| R5-03 | Different operation cannot mint another receipt under same Shop/invoice |
| R5-04 | Same invoice + operation IDs in two Shops keep distinct totals and lines |
| R5-05 | Late invalid line or money leg rolls back **all** header, lines, tender and seal writes |
| R5-06 | Product catalog price change cannot reprice historical persisted return entitlement |
| R5-07 | No collected payment means no cash-backed refund, without falsely altering the synthetic immutable invoice due |
| R5-08 | Cash refund draws down previously received amount; duplicate return is replay only |
| R5-09 | A second return cannot exceed its original line or the remaining collected funds |
| R5-10 | Cross-Shop / unknown source line return refuses rather than acquiring another Shop's receipt |
| R5-11 | Test Worker public `/api/rpc` remains 404; no production transaction route |
| R5-12 | Direct SQL UPDATE/DELETE/late INSERT cannot mutate sealed headers, lines, tenders, seals or return records |
| R5-13 | Concurrent identical operation attempts produce one inserted record and one replay |
| R5-14 | Concurrent independent returns cannot both spend the same verified funds |

## Implementation proof and limitations

**Superpowers RED:** A new integration spec imports a missing M08-only local fixture and fails with `ERR_MODULE_NOT_FOUND`, before fixture implementation. This intentionally verifies new acceptance coverage and does not misrepresent a production defect.

**GREEN:** The narrow fixture creates disposable `m08_r5_*` tables and additive triggers inside a local Workerd D1 test. Actual invoice quote calculation calls the merged `allocateInvoicePaisa`; tenders call the merged source-faithful `normalizeSalePayments_`. No second operational calculator or live D1 schema exists.

**Safety review:** The synthetic invoice due field is immutable evidence, **not** Customer AR: a future new-shop Store Credit refund must adjust real Customer ledger balances through a separately approved M03/M08 atomic posting. The test intentionally does not attempt that. The D1 quote fixture uses a deliberately small **1-billion-paisa per-value test bound**, not the business's unapproved actual amount maximum. The SHA-256 fingerprint is test-side operation evidence, not authenticated caller/session proof. The fixture's payment rows are synthetic verified incoming legs, not a substitute for proof of reversal/chargeback/settlement in the operational financial source. A Cash Session check is still required at the eventual M03/M04 financial SQL boundary.

**Owner sign-off STILL OPEN:** HALF_UP vs HALF_EVEN, source-vs-header rounding strategy, 12/12 decimal scale, 36-digit ratios, 100-vs-200 POS max lines, refund/correction limits and real inventory/accounting classification. M02 historical Supplier source provenance reconciliation remains independently required. An isolated green suite and merge of this PR cannot approve any of them by implication.

**Release gate:** Full exact-head GitHub CI, independent Super QA/Review, human-reviewed merge. No Cloudflare hosted migration, owner login activation, public RPC, live Shop posting or business data import.
