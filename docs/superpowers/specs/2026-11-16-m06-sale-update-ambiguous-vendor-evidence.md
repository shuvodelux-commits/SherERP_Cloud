# M06 — Sales Update Mode ambiguous vendor-source history guard

## Business decision
The frozen source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` in `SalesManagement.gs::getSaleForUpdate` groups active `VENDOR_SOURCING` records into a map indexed by `Product ID`; repeated active records overwrite earlier values. The target pure `src/modules/sale-update-read-model.js` reproduces that map. This is source-compatible for unambiguous records but hazardous when imported historical records contain **two simultaneously active vendor-sourcing records for the same invoice and product**: the final row silently becomes the edit prefill source, losing evidence of multiple possible vendor obligations/costs.

A product sold with mixed vendor sourcing is not made unambiguous merely by the Product ID. The migration must preserve original source records, not choose the last arbitrary row to represent a unique counterparty. Selecting a specific source row for a future edited sale requires reviewed identity and obligation allocation, which is beyond this read-only contract.

## Intended behavior
1. When `projectSaleForUpdate` receives two or more active vendor sourcing records with the same exact `Invoice ID` and `Product ID`, fail closed with `NEEDS_REVIEW: ambiguous historical vendor sourcing for Sales Update Mode`.
2. Keep one active vendor row and any number of deleted tombstones valid, preserving exact frozen-source edit payload for normal invoices.
3. Different Product IDs and other invoices are not duplicates. Do not count deleted records or infer that names/phone match a vendor identity.
4. If a record is ambiguous, return no partially constructed invoice. Do not silently auto-net Payables or choose a supplier, vendor, or last row.
5. Preserve sales.edit permission gate, original Cash Session edit gate, split-payment source parity, bundle snapshot and return guards.

## Isolation / safety
Only `src/modules/sale-update-read-model.js`, its test file, and spec/plan docs may change. There are **no data writes**, no D1 migrations, no Worker RPC or public binding, no front-end changes, no edit handler, no repairs or reconciliation of source records. This is not permission to enable production Sale Updates or to change original GAS. PR #380 Sales Management original money and PR #333 posting synthetic fixture and PR #313 multi-unit core stay untouched. All active source data must be preserved for human reconciliation.

## Superpowers TDD / acceptance
Add regression tests before implementation, observe intentional missing exception with valid fixture in GitHub RED, introduce smallest preflight duplicate check, then verify full exact-head GitHub checks (Foundation, local Workerd/D1, Chromium, Cloudflare PR safety), leave draft/unmerged for owner review. Valid historical vendor row and deleted duplicates continue matching source output. No production readiness claim.
