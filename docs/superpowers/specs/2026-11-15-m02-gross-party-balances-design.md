# M02-P Gross Party Financial Checkpoint Preflight (2026-11-15)

## Decision and purpose
Build a **source-only, offline, read-only** reconciliation checkpoint used before authorizing Party financial account SQL. This does not create financial accounts, ledger entries, migration DDL, RPC endpoints or a manual cross-role settlement engine. It consumes explicit local source-shaped master and finance transaction snapshots; no Google Sheets, Cloudflare D1, credentials or live ERP are accessed.

Original pinned source: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. Authority: `AGENTS.md`, `ADR-007-unified-party-relationships.md`, `OpeningBalance.gs`, `FinanceModule.gs`, `Vendors.gs`, `DeleteEngine.gs`, `Config.gs`.

## Source-grounded financial rules
- Customer `Current Due > 0` is receivable, `< 0` is customer advance. Supplier `Current Due > 0` is payable, `< 0` is supplier advance. Their signed `Opening Balance` is a **separate historical checkpoint**, not additional current money, and must not generate Cash/Bank or Cash Session activity.
- Vendor `Current Due` (payable) and `Current Receivable` (receivable) are distinct simultaneous gross buckets, not an offset. Negative vendor column values require manual reconciliation rather than silently reversing accounts.
- Finance persons have **no stored master balance**. Their `FINANCE_TRANSACTIONS` are grouped per **stable Person ID** and per original finance account type using nine transaction types and their exact source `balanceEffect`. Owner equity, lender loan and borrower loan must not net across one another or across different Person IDs sharing a reviewed Party. Negative signed per-account totals become owner advance, lender credit or borrower credit per `financeBalanceSummary_`.
- Soft-deleted finance entries have no current effect; unresolved/missing Person ID rows must **not** be attributed by matching names. Unknown types, duplicate active transaction IDs, missing evidence and balance parse failures block readiness. A Payee-only role creates zero money accounts.
- Financial amounts are stored in **integer minor units** for this review. Reject unsupported sub-paisa precision, nonfinite values and invalid currency-like strings rather than silently coercing. These checkpoints use BDT as an explicitly local provisional assumption; cross-currency multi-tenant import needs a separate policy gate.

## Interfaces and output
- New pure module `src/party/gross-balance-preflight.js` exports `prepareGrossPartyBalances({sourceRows,approvedGroups=[],financeRows})`. Explicit financeRows array required, including an explicit empty array; its absence is a coverage failure, not proof of zero obligations.
- Internally calls existing `planPartyImport`; the supplied reviewed-group metadata remains an *unverified planning claim*, not a production approval or staff authentication. Builds exact `(sourceGroup,sourceId)` link lookup, never matching phone/name for financial attribution.
- Emits separate sorted `currentCheckpoints` and `openingCheckpoints`, `grossCurrentTotalsMinor` keyed by account kind, `grossOpeningTotalsMinor`, `blockingIssues` with reason codes only and source group/row provenance, and a minimal PII-free `summary`.
- Current master signed balances split to a **single** positive account kind for each row; no negative positions are silently netted against another person's balance. A finance Person ID may generate separate owner, lender and borrower account checkpoints; each signed account kind splits into the corresponding positive or negative category after source transaction effects are summed **per legacy Person ID**.
- Results omit names, phones, addresses, credentials and full transaction records but **include source-ID provenance**, which may itself identify a real customer; keep any real output private and do not commit real snapshots. No CLI is added. GitHub tests are synthetic only.
- `readyForAccountDesignReview` means source fixture review has no blocked identity/transaction coverage; **not approved for D1 writes or real cutover**.

## Alternatives considered
1. Generate `party_accounts` SQL now: rejected, owner-policy and M03 atomic transaction kernel gates incomplete.
2. Net all seven roles into one Party balance: rejected, violates ADR-007 and can corrupt customer/supplier/vendor/loan meaning.
3. **Selected:** lossless, source-ID-constrained **gross** checkpoints with explicit blockers and deterministic offline tests. Can inform later D1 account DDL design without creating a second accounting authority.

## Test/release contract
TDD synthetic tests for customer/supplier +/- opening/current, simultaneous vendor AP/AR, same-party multi-role no netting, three finance accounts and negative buckets, deleted finance entries, unknown/blank Person ID, duplicate finance ID, invalid decimals, missing identity link or quarantined master, and input non-mutation. Validate against original column name and transaction-type source snippets. No real D1, remote writes, posting/reversals, auth or UI changes. PR stays isolated in M02-P safe lane; **PARALLEL-MODULE-READY remains false**.
