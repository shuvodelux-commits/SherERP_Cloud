# M06 Super QA follow-up: nested Tile rational snapshot accessor guard

**Date:** 2026-11-17  
**Workstream:** M06, issue #314 / board #456. Super QA evidence: merged PR #525.  
**Base:** `SherERP_Cloud/main@40f6ae4b9cb6f17bbd6fed72a3455ba356ffed02`.  
**Frozen business source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.  
**Related approved math:** M02 `src/modules/tile-quantity-contract.js`; **do not edit** it.

## Finding

`auditMultiTileSaleCheckoutEvidence()` validates its top-level, line, quote, payment, quantity, measurement and request objects with own-descriptor checks. However, the nested saved rational-area and pricing records (`quantity.actualSqft`, optional `quantity.requestedSqft`, `salePreview.billingQuantity`, `salePreview.exactAmount`) are subsequently read by `fraction()` without a descriptor check. An accessor-backed snapshot can therefore execute caller-supplied code during what should be a pure read-only audit. This violates the existing no-caller-getter trust boundary and complicates historical financial evidence review. The fix must remain diagnostic only; no SQL, RPC, stock authority, posting permission, authentication or Cash Session is in scope.

## RED → GREEN

1. **RED:** Add `tests/m06-tile-rational-accessor-qa.test.mjs` covering each nested rational in otherwise valid pack/area Tile quotes. For each, create an own accessor with a side-effect counter and assert that the audit **throws `Invalid trusted Tile rational...` without ever invoking the getter**. Verify the baseline produces `ready:true`, `postingAllowed:false` and unchanged exact paisa values, including manufacturer-independent nominal area.
2. Observe expected RED on GitHub CI for the exact regression-test-only commit; distinguish the new focused failures from baseline or infrastructure failures.
3. **GREEN:** In **only** `src/modules/m06-tile-checkout-evidence-audit.js`, run the already available `record()` own-descriptor guard on supplied rational records before accessing numerator/denominator. Fail invalid rational fields closed (never coerce objects to strings). Preserve equality math, source quote/rounding rules, and existing issue codes for ordinary tampering.
4. Run all Node unit, source and browser checks, real local Workerd/D1 integration where mandated by existing CI, on the same exact PR head. Do not bypass any check.
5. Open one M06 branch PR. Merge only after full exact-head CI, dependency and current-main review; do not touch common M03/M04/M05/M07/M08 or frontend files.

## Acceptance

- Valid pack and area quote snapshots unchanged; exact rational money is never derived from displayed rounded Sqft.
- Accessor getters on all four rational evidence positions are not called.
- Malformed rational shape remains fail-closed.
- Posting authorization always `false`.
- No shared-file changes, database transactions, route changes, source mutation, or private data.
