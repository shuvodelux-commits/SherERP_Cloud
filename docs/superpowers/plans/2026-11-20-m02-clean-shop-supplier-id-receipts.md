# M02 Run 8 — clean-shop Supplier ID receipt and Party-link contract

**Status:** Read-only internal evidence shape; not a Supplier writer, historic importer, or production authorization.  
**Base:** `SherERP_Cloud main@872ca8560906afe9dfd2ee8e7e8e80be4a597158`.  
**Pinned source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and `Config.gs` sequential family `SUPPLIERS -> SUP`.  
**Coordination:** M02 #24; M03 #22; M08 #66; #456 parallel ownership; #690 clean-shop.  
**Starting state:** M02 #726 and M03 Control Center #722 merged, #727/#728 rounding comparisons merged; no open PR at branch creation. Technical M08 rounding scale/boundary remains unsigned.

## Implementation overview — 12 sentences

1. The first clean-business purchase must address a Supplier by a stable, shop-local original-style Supplier ID rather than by a name or phone.
2. The merged M02 Run 7 offline source-link rehearsal checks purchase/return lineage but does not check newly issued Supplier operation receipts.
3. M03 already owns a synthetic SQL source-ID issuer and exact original `SUPPLIERS -> SUP` prefix mapping, so M02 must not implement another allocator.
4. This run supplies a **read-only** validation contract that accepts only an explicit snapshot of candidate Supplier issuance receipts and Party-role links.
5. Each new receipt must retain exact Shop ID, `SUPPLIERS` family, `SUP-000001`-style ID, positive safe-integer sequence, stable operation ID and lowercase SHA-256 intent hash.
6. The same Source ID in two distinct Shops is permitted, but two different operations or rows claiming one ID within a Shop are rejected.
7. A repeated operation ID cannot claim a second Source ID or a changed intent and does not authorize a blind retry.
8. Every receipt requires exactly one Shop-local Supplier Party link, preserving any other Party roles as independent identities/accounts.
9. Name, phone, customer role and row count are never used to allocate or infer a Supplier identity.
10. Deleted historical Source IDs and original DocumentProperties counters remain a separate protected legacy-reconciliation gate and cannot be inferred from this new-shop snapshot.
11. Tests must fail first for the missing implementation and pass after the smallest pure module is added, with redacted counts/codes and no writes.
12. The single M03 integrator later needs real Workerd/D1 SQL uniqueness, current actor permissions, Cash Session and immutable operation receipt inside the purchase mutation before authorizing financial posting.

## Exclusive paths

- **NEW:** `src/party/m02-clean-shop-supplier-identity.js` (M02-only pure read-only helper; no operational imports).
- **NEW:** `tests/m02-clean-shop-supplier-identity.test.mjs` (Node acceptance and negative cases).
- **NEW:** this plan `docs/superpowers/plans/2026-11-20-m02-clean-shop-supplier-id-receipts.md`.

No changes to `src/db/**`, migrations, `src/rpc/**`, `src/index.js`, Worker/config/Cloudflare bindings, source GAS, `frontend/**`, Control Center or M08 monetary references. M03 reserves every actual Supplier ID writer/SQL and all private account bindings.

## Acceptance and safe interpretation

- Two synthetic shops may each possess `SUP-000001` while preserving separate Party IDs and receipt scopes.
- Same-Shop duplicate ID/operation ID, same-ID different sequence, mismatched Source Group, invalid prefix, invalid padding, forged intent, missing or duplicated Supplier role link, cross-shop or cross-Party link and disabled Supplier state all fail closed with fixed redacted codes.
- Frozen `Config.gs` is verified by existing source checks and the test imports the current M03 mapping for exact `SUP` prefix; no hardcoded second issuer.
- The function is a pure audit of supplied records, **not** proof that the records were obtained from a trusted D1 transaction. It returns only `syntheticReceiptShapeValid`, counts, blocker codes and unconditional `sqlIssuanceAuthorized:false`, `historicalReconciled:false`, `financialPostingReady:false`.
- This PR cannot close M02 #24 historical 49-group provenance, M08 #66 numeric decision, SQL-time M03/M04 authority or M10/M11 recovery/cutover gates.

## Superpowers evidence sequence

1. Commit this plan and new test without the implementation; observe actual focused RED (`ERR_MODULE_NOT_FOUND`).
2. Add the minimal pure M02 helper; run all Node regression and exact-head GitHub CI.
3. Review changed paths against any newly opened PR; coordinate in #456 and #24.
4. Require independent `/super qa`, `/super review` and explicit owner merge; no automatic merge.
