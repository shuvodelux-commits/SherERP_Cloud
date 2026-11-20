# M08 Run 6 — money text / M06 Number interop gate and final technical decision request

**Status:** M08-only internal precision safety implementation; technical accounting policy **NOT YET SIGNED**.  
**Baseline:** `SherERP_Cloud main@2536640a9f6e6b6c409486b26e545c501cfa4a6a` after verified merged M08 Run 5 #732 and M03/M10 #735/#736.  
**Original source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, unchanged.  
**Issue owners:** M08 #66, M02 #24, M03 #22, M04 #23, M05 #314, coordination #456.  
**PR:** M08 Run 6 #741; current separate M04 #737 changes different paths.

## Implementation overview (12 sentences)

1. The first five M08 runs proved exact rational money, source differences, whole-paisa allocation, synthetic receipt immutability and refund replay, but not the final new-shop numerical policy.
2. The existing source-faithful M06 POS payment helper internally measures money in integer paisa and then emits BDT `Number` values for its caller.
3. The M08 reference calculator currently permits integer money up to JavaScript `Number.MAX_SAFE_INTEGER` paisa.
4. At that extreme, the M06 `Number` BDT output is not guaranteed to retain the original final paisa after it is rendered back to decimal text.
5. A real source helper example with `90071992547409.91` BDT produces `90071992547409.9` as a Number output and reparsing it loses one paisa.
6. Run 6 therefore introduces a small **M08-only, non-posting** text boundary with canonical integer-paisa and decimal-BDT conversions performed solely through BigInt and string operations.
7. It calls the unchanged original M06 split-payment calculator only in a pure audit path and refuses its output whenever returned paid, due, change or tender legs fail to conserve the original whole-paisa invoice total exactly.
8. It refuses numeric tender inputs, unsafe magnitudes, exponent notation, negative zero, accessory/proxy-like object inputs and malformed account snapshots before the legacy helper is invoked.
9. Explicitly signed pure corrections are permitted by a separate opt-in parser, whereas new Cash and Bank tender instructions must remain nonnegative.
10. Normal Bank/Cash splits, Cash change, unpaid invoices, zero-value rules and 300 seeded payment cases must conserve the original approved whole-paisa amount without changing the source helper.
11. The adapter returns **only whole-paisa string evidence** and never modifies source records, creates a financial DB table, authorizes a party, writes Cash/Bank/AR/AP or exposes public RPC.
12. This is a precision guard that must precede any future M03/M04 operational money writer, not a substitute for owner-signed tie/scale/line allocation, auth, stock/FIFO, settlement, return, chargeback or source-reconciliation decisions.

## Confirmed real source-interop precision hazard

| Step | Exact value | Observation |
|---|---|---|
| M08 proposed maximum | 9,007,199,254,740,991 paisa | Integer within `Number.MAX_SAFE_INTEGER` |
| Exact BDT text | `90071992547409.91` | Contains **91 paisa** |
| Existing M06 input parser | `9007199254740991` paisa | Can initially accept this integer |
| Existing M06 Number-valued due output | `90071992547409.9` BDT | The original 1-paisa suffix is no longer distinguishable as text |
| Reparsed M06 output | `9007199254740990` paisa | **Lost 1 paisa** |
| New M08 boundary | **reject** | Protects accounting from silent loss without changing historical source functions |

**Scope of finding:** this is a demonstrable high-range source interoperability failure; it is not a measured production invoice failure or an indication that common small invoices are wrong. `Number.MAX_SAFE_INTEGER` is not an adequate *BDT float round-trip* guarantee. Historical source values must not be altered to comply with future rules. New-shop transaction SQL should carry integer minor-unit values and raw decimal lexical source values, never JS Number-derived books.

## Technical monetary contract proposed to owner (NOT approved by merging this PR)

| # | Decision required | Recommended new-shop MVP choice | Acceptance gate |
|---|---|---|---|
| 1 | **Rounding tie** | HALF_UP at positive invoice grand; for corrections, reverse the **persisted original** allocated paisa rather than re-rounding negative floats | M08/owner formally select tie and signed reversal |
| 2 | **Boundary** | Sum exact `quantity × verified unit ratio × original price` as rational, apply exact discount, round invoice grand **once**, distribute allocated paisa by largest remainder with stable immutable line ID tie | M05/M06/M07 source-vs-new differences explicitly reviewed |
| 3 | **Source decimal limits** | Quantity/unit price canonical text up to 12 fractional digits, currently proposed ≤1,000,000,000 per input; Tiles ratios up to 36 digits | M05 Tiles / multiunit tests, overflow and user-facing validation |
| 4 | **Money and SQL limits** | Money books always **INTEGER paisa**, never SQLite REAL/JS Number; reject any M06 Number output not exactly round-trippable; defer approval of ultimate invoice maximum | M03 SQL signed 64-bit aggregate, journal and concurrency checks |
| 5 | **Invoice line cap** | Retain existing POS V2 **100 lines** for MVP, rather than silently raising it to the M08 calculator's 200 test cap | M01 original UI and M06 agreement; standalone purchase limit separately reviewed |
| 6 | **Supplier final return** | Reimburse against original immutable line allocation; final balancing paisa permitted, any adjustment over **one paisa requires review** pending an approved cumulative-delta design | M07 native reverse and M08 #66 sign-off |
| 7 | **Cash refund backing** | Refund no more than verified invoice-linked **settled net money** minus attributable prior refunds/reversals/chargebacks, not a request-supplied balance; remaining eligible value may become appropriately authorized Store Credit/AR, NOT arbitrary cash | Real M04 SQL-time identity/session and M03 money-book atomicity |
| 8 | **Excess discount** | Preserve original zero-floor `max(0,subtotal-discount)` in source comparison; for **new** MVP operational transactions, recommend rejecting discount over subtotal rather than silently accepting a payable with wasted discount | Explicit owner policy difference + signed tests needed |
| 9 | **Party/Shop** | Independent Customer AR, Supplier AP, Supplier cash-backed advance and noncash return credit; exact source Supplier ID provenance; no name/phone auto-links or cross-role netting | M02 clean shop issuance + separate historic 49-group reconciliation |
| 10 | **Posting owner** | **One M03 integrator**, versioned immutable receipt and same idempotency key for stock/cost/Payable/Cash/Bank/AR/return, M04 current authority/Shop/Cash Session inside D1 SQL transaction | Real local Workerd/D1 negative/replay/late abort tests before live release |

No specific value for item 4's maximum can be approved merely because this reference accepts `MAX_SAFE_INTEGER`; the operational limit is a separate rule. The new M08 guard **rejects** unsafe values at the existing M06 Number boundary but does not increase the underlying original helper's precision. Future M03 writer should consume trusted integer-paisa output directly, without floating BDT materialization.

## TDD and independent review

- **RED:** `tests/m08-money-text-boundary.test.mjs` was committed first on branch `m08/payment-number-roundtrip-guard-run6`; [GitHub RED workflow run](https://github.com/shuvodelux-commits/SherERP_Cloud/actions/runs/44683190623) observed `ERR_MODULE_NOT_FOUND` on the missing boundary and retained all other source tests. Test suite includes a direct execution of the ORIGINAL M06 helper to exhibit 1-paisa loss without changing it.
- **GREEN:** `src/modules/m08-money-text-boundary.js` implements canonical BigInt/string conversions and a read-only source M06 compatibility audit that throws if any paisa is lost. No original financial helper changed.
- **QA:** normal M06 split, Bank+Cash change, unpaid due, zero Cash, high maximum, negative correction opt-in, bad tender/identity, immutability, and deterministic 300 split baskets; test-only, no Workerd SQL required for this pure conversion.
- **Review boundaries:** Exactly three M08-owned files (new module, new tests, this document). No edits to `src/db/**`, `migrations/**`, `src/rpc/**`, Workers, `wrangler*.jsonc`, cash/bank/Party ledger, UI, source, hosted D1 or M04 #737 paths. Existing isolated M08 Workerd/D1 regression workflows still run in full CI.
- **Sign-off:** Human-reviewed merge is allowed only after exact-head GitHub checks and independent QA/Review; **merging this PR does not sign the proposed numeric policy or enable any financial postings.**
