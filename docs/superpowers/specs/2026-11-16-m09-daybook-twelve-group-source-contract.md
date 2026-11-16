# M09 — Frozen 12-group Day Book source schema contract

**Source authority:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` `legacy/source/Config.gs` with the checked-in `docs/baseline/schema-inventory.json`; `DayBook.gs` is the source of aggregation order and group selection. **Dependency:** merged #403 pure-complete Day Book snapshot composer. The independent prerequisite #409 M04/D1 source-presence diagnostic remains under CI and is not silently treated as merged.

## Design in thirteen statements

1. All twelve Day Book source groups must be mapped to their original frozen `Config.gs` group names before any D1 import can be reviewed.
2. A table existing in `sqlite_schema` cannot establish that it has the original columns, correct source row identities or original business data.
3. Add one **pure internal** `verifyDayBookSourceSchema(inventory)` that checks the source inventory's complete exact ordered header arrays for all twelve groups.
4. The original group order is Sales, Sales Return, Purchases, Purchase Return, Customer Ledger, Supplier Ledger, Expenses, Finance Transactions, Bank Transfers, Bank Book, Stock Movement and Cash Book; the composer owns different transaction-section presentation order.
5. Every group has an immutable `sourceGroup`, `sheetKey`, `identityColumn`, `sheetName` and `headers` descriptor; `identityColumn` names are the original **header** (`Invoice ID`, `Return ID`, `Purchase ID`, `Ledger ID`, `Expense ID`, `Finance ID`, `Transfer ID`, `Entry ID` or `Movement ID`), not an assertion that every historical row has an ID.
6. The `CUSTOMER_LEDGER` and `SUPPLIER_LEDGER` remain **separate economic accounts** despite approved unified Party identity; no auto-netting of gross balances.
7. The Cash Book and Bank Book may contain historical ID-less entries; **never fabricate IDs**, trust rowid as source identity or delete such records.
8. Validation must reject missing, duplicate or noncanonical source groups, changed or reordered columns, unreviewed new columns, duplicate headings, accessors, symbols and malformed inventory descriptors before returning mappings.
9. The input `inventory.tables` contains many non-Day-Book groups, which are allowed, but the twelve required groups must each occur **exactly once**.
10. The returned metadata must be owned copies, frozen deeply enough that consumers cannot mutate a later validation, and make no row-level claims.
11. No D1 access, migration, public RPC, auth, business row retrieval, locale/date normalization or financial posting belongs in this module.
12. Tests must compare the descriptors against actual pinned `schema-inventory.json` and inject corrupted identities, unexpected headers and hostile JavaScript input.
13. Keep the next full D1 **source-row mapping, idempotent import provenance, tenant boundary and financial reconciliation** as separately reviewed M02/M03/M09/M10 work; M11 cutover remains blocked.

## Files and safety
- `docs/superpowers/specs/2026-11-16-m09-daybook-twelve-group-source-contract.md` (this design)
- `docs/superpowers/plans/2026-11-16-m09-daybook-twelve-group-source-contract.md`
- `tests/m09-daybook-source-schema-contract.test.mjs` (RED before implementation)
- `src/modules/m09-daybook-source-schema-contract.js` (minimal GREEN)

All files additive. No changes to frozen source, `docs/baseline/schema-inventory.json`, D1 migrations, transaction writers, `src/rpc/registry.js`, Worker config or production data. Rollback delete these four files.
