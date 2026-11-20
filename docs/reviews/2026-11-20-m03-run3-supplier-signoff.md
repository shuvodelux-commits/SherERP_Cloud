# Run 3 supplier contract sign-off

M02 [#24](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/24)
and M08 [#66](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/66)
approval is pending for [#690](https://github.com/shuvodelux-commits/SherERP_Cloud/issues/690).
This review uses main at `28583f9b5066903a951c96b2706d213aec53c54b` and the
frozen Mohim_ERP source at `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
[#708](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/708) supplies
the local reference receipts. [#709](https://github.com/shuvodelux-commits/SherERP_Cloud/pull/709)
supplies the [source contract candidate](2026-11-20-m02-m08-purchase-financial-contract.md).
Its merge record contains no contract approval.

## M02 decision on identity and reconciliation

Approve or amend these provenance rules in #24.

- Resolve the active supplier in the verified Shop as `(SUPPLIERS, Supplier ID)`.
  Retain the original identity and physical row lineage, including inactive and
  deleted history. Attach any shared Party through an explicitly reviewed link.
  Block an ambiguous identity or unmatched ledger row for review.
- Reconcile each supplier independently. Compare historical opening, current
  master due, effective native ledger debits and credits, and the replayed
  outstanding obligations and supplier credits. Count an opening ledger leg
  once. Preserve any original Cash Book opening baseline as historical evidence
  and exclude it from current Cash Session turnover.
- Preserve purchase, payment, return and ledger references. When legacy
  references are ambiguous, record the discrepancy and retain the source IDs
  and positions. Attach only aggregate reconciliation results and a reference
  to the approved source package in GitHub. Source evidence used here is frozen
  code plus synthetic fixtures. Private source amounts remain unverified.

## M08 decision on payables, advances and cost

Approve or amend these accounting rules in #66.

- A purchase's unpaid part debits the native Supplier Ledger. A direct payment
  debits its Cash or Bank Book. Later supplier payments credit Supplier Ledger
  for payment plus any approved discount and debit the money book for the
  payment alone. A payment without a discount may cross zero into an advance.
  A settlement discount requires its own permission and cannot cross zero.
- Keep supplier payable and advance separate from the same Party's customer AR.
  Preserve the distinction between money-backed supplier advance and noncash
  supplier credit. `SupplierSettlement.gs` replays by business date, physical
  row and Ledger ID. Untargeted payments pay oldest obligations first. Return
  credits target the original purchase first, then oldest obligations; unused
  noncash credit becomes store credit. Purchase debits consume store credit
  before money-backed advance pools. Retain the backing source for each
  allocation and verify the original tender before permitting a cash refund.
- Preserve purchase input capping. The source retains the entered nonnegative
  discount, floors the grand total at zero and caps immediate payment at that
  total. For zero paid it stores a blank method. Exact canonical quantities and
  original lot unit costs should survive conversion. Choose the approved stored
  scales, posting-rounding boundary, tie rule and bounds for fractional
  quantities and sub-paisa values. Choose whether to retain source per-return
  credits and account for the residual or approve cumulative rounding to absorb
  it. Record the selected policy and fixtures before schema review.

### Source cases that distinguish the precision policies

These probes ran the pinned `createPurchase` and `completePurchaseReturn`
bodies using the synthetic #709 harness. The probes fix the input and expected
source behavior for review.

| Case | Observed source result |
| --- | --- |
| 1 × ৳60, discount ৳70, tender offered ৳25 | Stored discount ৳70. Grand total, paid and due all zero. Blank method and Paid status. |
| 1 × ৳60, tender offered ৳70 | Paid and Cash Book debit capped at ৳60. |
| 0.5 × ৳10.005 on credit | Lot unit cost ৳10.005 and subtotal and due ৳5.0025 reach the sheet writes. |
| 3 × ৳1, discount ৳2, three separate one-unit supplier-credit returns | Each return credits ৳0.33. Supplier due retains a one-paisa residual, subject to source floating-point representation. |
| Same discounted purchase, all three units returned at once | One credit of ৳1.00. Supplier due is zero. |

## M03 handoff after sign-off

1. Link both decisions and the approved provenance and reconciliation evidence.
   M03 owns the proposal for the operational schema and shared posting contract.
2. On the reviewed schema, use an isolated local Workerd/D1 test with 10 units
   at ৳60 on credit and 10 units at ৳75 for cash. Expect stock 20 across two
   original supplier lots, total cost ৳1,350, supplier payable ৳600, drawer
   movement −৳750 and same-Party customer AR still ৳90. Record the expected RED
   failure before adding the writer. Link the purchase, line, lot, movement,
   supplier-ledger and cash identifiers and assert replay changes none of them.
3. Use the same SQL atomic boundary for current authenticated actor and Shop,
   `purchase:add`, an open Cash Session (including zero-paid and bank purchases),
   reviewed supplier, product version, receipt and all effects. Cover stale or
   concurrent requests, changed-intent replay, failure on the last ledger leg
   and exactly-once reversal against the original purchase and lot. Keep the
   [posting gate](2026-11-20-m03-purchase-posting-gate.md) and separate remote
   migration and activation approvals in force.
