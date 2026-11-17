# M09 Source-complete Reports eligibility — design

**Issue:** #431. **Pinned original:** Mohim_ERP `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `Reports.gs` and `Config.gs`. **Workstream:** M09.

## Intent and scope
The six source-faithful report projections exist but have no approved, authenticated complete-D1 input. A report built from partial imported transactions could present a plausible yet false amount. Build a small *internal, pure, read-only evidence diagnostic*, not a live report API or authorization check.

## Approach
Choose a fixed report-to-source dependency matrix and validate a **trusted backend-provided evidence summary**, containing source-group import row-count parity, original record provenance and deletion-state review, plus explicit review flags (auth and tenant boundaries, cross-account finance, return lineage, settlement, lots and cash/bank as applicable). Source keys must match frozen `Config.gs` exactly — **`SALES_RETURN_ITEMS`** (Issue #431's `SALE_RETURN_ITEMS` spelling is not a configured group). Reject malformed root evidence. Missing, invalid or unequal receipt counts and unverified flags block affected report evidence.

Return **only** report keys, finite predefined blocker field names, source-group keys and booleans. Never echo rows, actor/session tokens, IDs, ledger balances, review evidence contents or SQL. Even when every evidence flag is true, **`ready:false` always** and status `AWAITING_AUTHENTICATED_D1_GATE`: an untrusted fabricated summary must not grant access or switch on an endpoint. An authenticated D1 tenant/actor-scoped reader remains a later separate approval gate. The diagnostic is not a substitute for cryptographic provenance or actual reconciliation. The limited Balance Sheet specifically also requires `FINANCE_TRANSACTIONS`: frozen `FinanceModule.gs::getOwnerCapital_` and `getOutstandingLoan_` both derive from `activeRows_('FINANCE_TRANSACTIONS')`. A reviewed Finance summary flag alone must not mask a missing transaction source.

## Alternatives rejected
- Query production D1 and start report RPC now: blocked on reviewed complete M02 importer, M03/M04 source/actor scope and M08 gross account reconciliation.
- Treat `sqlite_schema` table existence or empty missing arrays as completeness: hides missing historic transactions and incorrect balances.
- Add UI or new report formulas: existing frozen projections and frontend must remain unchanged.

## Acceptance
1. Exact six report keys and source-group contracts; no unknown alias mistakenly accepted.
2. Missing/partial/mismatched/false proof blocks the affected reports; all-zero *reviewed* historical sources can be distinguished from unverified missing sources.
3. Gross customer/supplier/owner/loan evidence stays separate; no automatic Party netting.
4. No live endpoint ever considered ready, including synthetic all-true evidence.
5. Superpowers test-first RED (expected missing module) then minimal GREEN; full Node/source/CI verification; one GitHub PR left unmerged for owner review.
