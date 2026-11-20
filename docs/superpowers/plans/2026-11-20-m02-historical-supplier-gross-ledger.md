# M02 Run 10 — offline exact Supplier gross-ledger source reconciliation

**Workstream:** M02 #24, coordination #456; depends on merged #726 (Supplier source link), #730 (Shop Supplier identity), #748 (two local D1 receipt readback); M03 #22, M08 #66 remain distinct operational owners.  
**Base:** `main@8aaad241e920fc3ff4df7bd21f3f402b4ad3301d`; original frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Status:** offline, pure/read-only, synthetic test evidence; not an approved import, historic books certification, operational migration or posting permission.

## Implementation overview (12 sentences)

1. The existing M02 Supplier source-link checker validates original Supplier, Purchase, Return and Ledger references, but not the stored Supplier financial balances.
2. Original `Suppliers.gs`, `Purchase.gs` and `PurchaseReturn.gs` maintain Supplier `Current Due` using positive Debit and negative Credit ledger effects.
3. The source also accepts signed Supplier Opening Balance and negative Current Due, which must remain a **Supplier credit** rather than being silently netted with Customer or other Party roles.
4. This module will consume a caller-supplied Shop-scoped offline snapshot of original `SUPPLIERS` and `SUPPLIER_LEDGER` rows only.
5. It requires original literal Supplier/Ledger IDs and physical `_rowIndex` provenance, detecting duplicates and missing ledger Supplier references.
6. To prevent IEEE-754 rounding from declaring false financial equality, only canonical exact string-valued monetary evidence with zero to two decimal places will qualify for this narrow historic comparison.
7. Source numeric values or higher-precision rows remain unsupported evidence requiring explicit capture/review, not an automatic rounding operation.
8. For each Supplier independently, signed ledger `Debit - Credit` and recorded running `Balance` are compared in physical append-row order against original stored `Current Due`.
9. Opening Balance rows must use that Supplier's exact Source ID as Reference and reconcile in sign with its stored Opening Balance checkpoint.
10. Unknown ledger types are not assigned invented meanings; the persisted Debit/Credit fields are compared without guessing payment or return cash movement, while deleted or ambiguous rows fail closed.
11. Output contains only counts and fixed blocker codes; it never emits names, phones, financial values, original IDs or source file paths and always declares posting/import authorization false.
12. Red tests precede minimal implementation, followed by full Node/source checks, exact-head GitHub CI, independent QA/review and human-approved merge; real historical source capture and signed M02/M03/M08 policies remain separate blockers.

## Exclusive file ownership

- NEW: `src/party/m02-historical-supplier-gross-ledger.js` — pure offline auditor, **not imported by Worker/RPC**.
- NEW: `tests/m02-historical-supplier-gross-ledger.test.mjs` — synthetic TDD 16+ cases.
- NEW: `docs/superpowers/plans/2026-11-20-m02-historical-supplier-gross-ledger.md` — this plan.

No edits to original `legacy/source/**`, `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, frontend, Worker/Cloudflare bindings, shared CI, active M03 #758/#759 or M05 #756 paths.

## Acceptance gates

- Exact source ID + row identity and preserved positive/negative ledger sign; original purchase/return ownership itself remains separately enforced by merged Run 7.
- Payable and credit are never auto-netted across Supplier identities or other Party roles.
- Stale running balance, stale Current Due, incorrect opening sign/reference, duplicate Ledger ID or physical row, orphan Ledger Supplier, negative debit/credit, noncanonical/unsafe money, number coercion and deleted-row uncertainty are blocked with redacted codes.
- Source **physical append order** is used only to test the original persisted running-balance snapshot, not to reconstruct the user's transaction-date display order after backdating.
- No claim that all old historical rows are canonical two-decimal text; noncompliant evidence stays NO-GO pending approved historical capture and source-specific exception policy.
- `historicalSourceVerified:false`, `d1Reconciled:false`, `postingAuthorized:false` are unconditional even when a fully synthetic input passes.
