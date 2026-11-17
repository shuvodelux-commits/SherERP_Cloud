# M09 — Historical Finance Transactions Without Person ID (offline parity)

**Workstream:** M09 read-only reports/dashboard source integrity  
**Issue:** #567; prior M09 issue #431; coordination #456  
**Base:** `main@52611a0d9a147d68b019b7e36a108e482536c4ef`  
**Frozen GAS:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` — `FinanceModule.gs::financeTxnPersonKey_`, `financeSignedBalances_`, `Config.gs::FINANCE_TRANSACTIONS`  
**Own exactly:** `src/modules/m09-dashboard-offline-row-parity.js`, `tests/m09-dashboard-offline-row-parity.test.mjs`, this plan; no common files.

## Implementation overview (12 sentences)

1. M09 preserves the frozen source behavior where older `FINANCE_TRANSACTIONS` rows may predate the additive `Person ID` column.
2. Those rows can legitimately have an empty original Person ID, while current newer finance entries use stable reviewed Person IDs.
3. The existing normalized offline receipt schema requires a nonempty `accountSourceId` for all finance transactions, so it does not represent an unresolved legacy source identity without inventing a link.
4. A synthetic normalization must instead encode historical missing source identity as literal `null`, never an inferred name/phone match.
5. The comparator will accept this narrowly typed `null` for `FINANCE_TRANSACTIONS` only, rejecting blank strings, malformed IDs and null Customer/Supplier ledger references.
6. It will emit the fixed issue code `SOURCE_UNRESOLVED_LEGACY_FINANCE_ID` for a null source row and `IMPORTED_UNRESOLVED_LEGACY_FINANCE_ID` for a null imported row.
7. Matching source and import receipts with null IDs will still set `evidenceComplete:false` and `ready:false`, not report reconciliation as complete.
8. Any source-to-import drift from null to a fabricated account ID must remain separately blocked by `PARTY_SOURCE_LINK_DRIFT`.
9. Historical soft-deleted finance transactions must remain in the physical-row source snapshot rather than disappearing from audit history.
10. The test-first RED stage will assert these expected fixed codes, the absence of false provenance, and strict Customer/Supplier validation before changing production code.
11. The minimal GREEN implementation will use the existing deterministic per-side row scanner and must not access raw D1, real customer data, network, RPC, UI or posting infrastructure.
12. M02/M08 must independently review unresolved legacy finance identities and gross account directions before any authorized M09 reporting read is proposed to M03/M04.

## Acceptance / evidence

- Test-first RED confirms `accountSourceId:null` on finance rows is not yet handled with source-specific review blockers.
- GREEN permits only literal `null` on finance transaction account source links and returns nonauthorizing redacted unresolved-identity issues on both sides.
- Identical unresolved source/import rows cannot be deemed complete; null→fabricated-ID drift remains rejected.
- Preserve the original eight-group historical row parity output, all existing tests, deletion-state proof and gross Owner/Lender/Borrower account-kind separation.
- Never create or infer a Party identity from free-text `Person` values or names/phones.
- Full targeted Node plus exact-head CI including Workerd/D1/browser/source verification. Do not merge until every required workflow and qualifying independent review pass.

**Integration owner:** M03 retains all shared `src/db/**`, migrations, `src/rpc/**` and Worker entry. **Other dependencies:** M02 reviewed source import custody, M04 actor/tenant authority, M08 person account/gross parity, M10/M11 release. **Rollback:** revert these M09-only changes; no live database or financial side effects.
