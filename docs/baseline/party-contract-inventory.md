# M02-P0/P1 — Party source contracts and identity-only D1 schema

**Status:** Implementation proposal, source-fixture and SQLite tests; not migrated/operational.  
**Source:** `shuvodelux-commits/Mohim_ERP` commit `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Owner policy:** [ADR-007 / Party architecture draft PR #7](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/7). This PR **depends on** its approved Party policy being merged before integration.

## Verified legacy identity contract

| Legacy group | Stable original ID | Display name | Role(s) | Financial fields / authoritative source |
| --- | --- | --- | --- | --- |
| `CUSTOMERS` | Customer ID | Customer Name | Customer | Opening Balance, Current Due; `CUSTOMER_LEDGER` |
| `SUPPLIERS` | Supplier ID | Supplier Name | Supplier | Opening Balance, Current Due; `SUPPLIER_LEDGER` |
| `VENDORS` | Vendor ID | Vendor Name | Vendor | **Current Due and Current Receivable remain independent**; `VENDOR_LEDGER` |
| `FINANCE_PERSONS` | Person ID | Person Name | Owner / Lender / Borrower, combinable | No single stored master balance; `FINANCE_TRANSACTIONS` derives Owner capital, Lender loan payable, Borrower loan receivable separately |
| `EXPENSE_PAYEES` | Payee ID | Payee Name | Payee | Payee is a recipient identity, **not** an automatic payable; expenses refer to existing Ledger ID / Ledger Name |

Source modules checked: `Config.gs`, `Database.gs`, `Customer.gs`, `Suppliers.gs`, `Vendors.gs`, `FinanceModule.gs`, `Expense.gs`, `OpeningBalance.gs`, `PartyLedger.gs`. The frozen `docs/baseline/schema-inventory.json` is validated with `validatePartyContracts()` in CI.

`FinanceModule.gs` canonicalizes `Roles` in Owner/Lender/Borrower order, falls back to `Person Type`, and finally Owner for blank legacy data. `src/party/legacy-contracts.js` explicitly retains that behavior. It does not assign any ERP staff permission.

**Accounting boundaries:** Negative Customer/Supplier signed openings are advances/credits, not the same positive receivable/payable. Historical opening balance changes must not be counted as today's Cash Book/Bank Book turnover or require an active Cash Session solely because they are historical. Vendor AP and Vendor AR must not be netted; Owner equity must not turn into a loan; selected original Customer ID is authoritative in POS/drafts; anonymous cash sale is not required to create a Party.

## M02-P1 SQLite identity migration

`migrations/0002_party_identity.sql` adds only:

- `parties` — stable Party ID, name, optional phone/address, entity kind/status and timestamps. **Names/phones are intentionally not unique.**
- `party_roles` — one row per Party + any of seven descriptive roles; can deactivate a role; historical roles cannot be hard-deleted.
- `party_legacy_links` — unique `(source_group, source_id)` preserving original identity, optional legacy sheet row and reviewed-link provenance. A *second* legacy record joining the same Party requires `HUMAN_VERIFIED` plus reviewer and date. SQL triggers prohibit silently reassigning/deleting original links.
- `party_identity_review` — queue for missing source IDs, duplicate IDs, shared phones/names, legacy-name aliases and conflicts. A review candidate alone never creates a Party/financial link.

SQLite `STRICT` tables, FKs, uniqueness, status CHECKs and restrictive triggers guard the data. The schema deliberately does **not** add `party_accounts`, `party_account_entries`, `journal_entries`, settlement tables, global `current_due`, Cash/Bank postings, RBAC permissions or an automatic identity resolver.

## Test evidence and limitations

- `tests/contract/party-contract.test.mjs`: exact group/column contract, combined finance roles and source drift rejection.
- `tests/integration/party-schema.test.mjs`: applies `0001_core_catalog.sql` then `0002_party_identity.sql` to in-memory SQLite; checks seven roles, same-phone different Parties, duplicate source ID, explicit human-reviewed cross-link, historical ID immutability, restricted FK and ambiguity queue.
- Local Node.js 22 `npm test` baseline: 27 tests passed, 0 failed. GitHub CI must independently pass on this PR.
- **Not yet proven:** actual Wrangler/D1 runtime behavior, full account mapping, deterministic private source import, ambiguous-identity resolution UI, approval permissions, any financial posting, or production migration.

## Rulings / follow-on gates

- **Ruling — no automatic cross-role linking:** A first `ORIGINAL_RECORD` mapping can seed a Party, but joining any later original ID to that Party requires a human-verified action with reviewer/date. This is deliberately stricter than same-phone matching.
- **Ruling — immutable original mapping:** Identity fields in historical `party_legacy_links` are immutable. Any correction must be a new, auditable reviewed procedure; unreviewed UPDATE/DELETE is prohibited.
- **Ruling — catalog migration independent:** The existing `0001_core_catalog.sql` is not changed here. Number `0002` applies after it and remains staging/local-only until an authorized production migration.
- **Ruling — no general ledger yet:** Party identity is separated from financial-account balances; an atomic, reconciled accounting transition needs a later ADR/PR.
- **Next Task M02-P2:** deterministic identity-import dry-run with synthetic duplicate-name/phone/missing-ID cases and no automatic merges. **No real customer data in GitHub.**
- **M02-P1 not complete** until real local Wrangler/D1 migration/test evidence and review are recorded.

Do not merge this stacked PR ahead of [PR #7](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/7) and foundational [PR #6](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/6).
