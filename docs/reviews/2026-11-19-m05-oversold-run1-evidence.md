# M05 Run 1 — Oversold Stock Exposure Audit: TDD Evidence

Date: 2026-11-19 (Asia/Dhaka)
Scope: Read-only audit only; no D1, GAS, RPC, migrations, UI or transaction writes.
Branch: m05/oversold-exposure-audit-run1-20261119
Plan: docs/superpowers/plans/2026-11-19-m05-oversold-lot-cost-parity.md (PR #684 — plan only).

## Root cause context
Original Mohim_ERP source gets the Product master Purchase Price for the Products and POS displayed purchase cost while individual stock lots store actual purchasing costs. The source valuation adds Remaining Quantity times Lot Purchase Price including negative OVERSOLD rows, and new purchases create a fresh positive lot without clearing outstanding negative lots. This isolated Run 1 audit diagnoses the behavior but DOES NOT repair it.

## Screenshot versus synthetic reproduction
User screenshots: 9 Foot current stock, -168 BDT valuation, 68 BDT displayed Product purchase price, a visible -229 Foot OVERSOLD lot at 68 BDT and +240 Foot purchased at 64.75 BDT. The two visible lots net 11 Foot and -32 BDT, not 9 Foot and -168 BDT. Another -2 Foot/-136 BDT is a mathematical inference, not a verified database record.

| Synthetic test | Net Foot | Source value | Conditional post-settlement unsold value | Conditional difference |
| --- | ---: | ---: | ---: | ---: |
| +240 @64.75, -229 @68, -2 @68 | 9 | -168 BDT | +582.75 BDT | +750.75 BDT |
| +240 @64.75, -229 @68 | 11 | -32 BDT | +712.25 BDT | +744.25 BDT |
| Only those visible lots, but cached stock = 9 | 11 vs 9 cached | -32 BDT | WITHHELD | WITHHELD |

Conditional amounts are unposted hypotheses. They must never authorize historical changes without M03/M08 signed-off settlement and cost-variance accounting.

## RED → GREEN evidence
Test runner: Node 22.16.0 in a scratch copy containing the two new files; the full repository could not be locally cloned because github.com DNS/network was unavailable.

1. RED: node --test tests/m05-oversold-exposure-audit.test.mjs returned ERR_MODULE_NOT_FOUND because the new audit module did not exist.
2. GREEN: same command after the pure module was implemented: 7 tests, 7 pass, 0 fail.
3. Mutation check: temporarily used gross positive quantity instead of net remaining quantity for the conditional valuation. The test failed with actual 15540 versus expected 582.75, then returned 7/7 after the mutation was removed.
4. Full npm test, verify:source and exact-head GitHub CI are not proven by these local focused tests. Review those checks before merge; do not claim green without their actual results.

## Interfaces and safety
Input: explicit trusted plain-object snapshot arrays named products, stockLots, saleItemLots, purchaseItems, stockMovements.
Output: per-product current and lot-stock quantities, gross positive and oversold quantities, original signed valuation, source lot IDs, discrepancy issues and a conditional illustration only for the unambiguous single-positive-lot case.
No SQL, no writes, no hidden Sheet/D1 reads, no local production record repair, no UI exposure, no auth bypass.

Needs Review blocks provisional valuation on missing/orphan/duplicate IDs, invalid quantities or prices, positive Deleted lots, a cached-versus-lot mismatch or missing/ambiguous sale/purchase lineage.

## Follow-up gates
Review this as read-only M05 Run 1. Do not merge or deploy on the strength of focused tests alone. Start pure M05 settlement-planner Run 2 only after reviewing source parity and branch collisions. Database posting remains exclusively M03-owned and blocked until M02/M03/M04 authority plus M08 accounting review. The live Mohim_ERP Apps Script screen is a separate deployment track.
