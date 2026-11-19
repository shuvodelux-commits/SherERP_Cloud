# Run 3 purchase posting gate evidence

The private purchase writer remains blocked. GitHub main at
`6325c83d0d1f088996e2ed0c107695e27a246efb` contains the Owner grant
lifecycle from #706. The clean Products path was open in #707 when this
review began. This PR is independent of #707 and contains a local proof
and the resume record.

- Workstream M03 integration under #690, #22 and #456. M05 purchase and
  reversal evidence belongs to #314. M02 supplier provenance and M08
  gross balances are tracked in #24 and #66.
- Frozen business source is Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
  No original code or data was transformed. The existing M05 suite owns
  the disposable purchase oracle. The shared financial schema and posting
  contract remain with M03.
- Effective decision is still the one recorded in
  [M03 readiness](../M03_PARALLEL_READINESS.md) and the
  [G1 handoff](../M03_G1_INTEGRATION_HANDOFF.md).

## Purchase contract to preserve

The pinned `Purchase.gs::createPurchase` checks `purchase:add` and calls
`requireActiveCashSession_` at entry, including when payment is zero or bank
tender is selected. The bank branch emits no drawer entry. The branch's
comment about sessions does not override the unconditional entry check.
Match the executable behavior unless the owner approves a contract change.

For each line, retain supplier ID, product ID, received quantity, cost,
listed selling price and transaction date. The stock movement references
the source purchase and lot. The lot uses the effective transaction date
for FIFO. A supplier payable increase is a source Supplier Ledger **Debit**
and a cash purchase payment is a Cash Book **Debit**. Keep those native
column directions distinct from general-ledger debit/credit nomenclature.
A return for supplier credit lowers the same supplier obligation and can
produce an advance. ADR-007 keeps that advance separate from customer AR
and the Party's other role accounts.

## Evidence and remaining dependencies

| Owner | Available evidence | Missing to integrate purchases |
|---|---|---|
| M02 with M08 | Reviewed identity, roles, links and import fixtures. Gross checkpoint rehearsal checks supplier advances, balance direction, source IDs and historical openings. The pinned source audit maps 49 groups, with 30 lacking source-specific DDL and zero marked fully reconciled. | Reviewed supplier/AP/advance mapping, source IDs and exact amount semantics across purchase, payment and return. Reconcile gross accounts and opening-to-current snapshots on an approved source package. |
| M03 with M05 | Operational Products and unit revisions exist. The M05 real local Workerd suite uses synthetic purchase, stock, lot, supplier and payment tables. The new reference case receives 10 at ৳60 on credit and 10 at ৳75 for cash. Expected stock is 20, initial lot cost is ৳1,350, Supplier AP is ৳600 and drawer movement is −৳750. Replays leave the database identical and same-Party customer AR stays ৳90. | The numbered baseline has no operational purchase headers/lines, supplier-account/obligation, lots, movements, session/payment or reversal tables for this path. Land a single reviewable operational schema proposal with ID issuance and exact quantity/cost representation once source mappings are accepted. |
| M04 with M03 | The Owner grant is Shop-scoped and fenced across replacement or removal. Synthetic tests check post-preflight authority and the current G1 contract calls for SQL enforcement. | Bind the trusted actor, verified Shop, current approved purchase permission and Cash Session state to the same SQL mutation as the purchase receipt. A valid catalog grant does not establish staff `purchase:add` or active Cash Session behavior. |
| M07 with M05/M08 | Local Cash and Supplier Credit return proofs reduce the original lot and check rollback. The supplemental oversold correction preflight identifies missing sale-item-lot lineage. | On the reviewed schema, preserve lot and original paid/due/obligation lineage and return exactly once. Require original sale-item-lot ID and cumulative cost/quantity reversal allocation before exposing settlement-linked writes. |

## Reproduce locally

```sh
npm run verify:source
node scripts/audit-migration-coverage.mjs --check
node scripts/dry-run-source-mapping.mjs --check
node --test tests/integration/m05-purchase-posting-workerd.spec.mjs \
  tests/integration/m07-purchase-cash-return-workerd.spec.mjs \
  tests/integration/m07-purchase-supplier-credit-workerd.spec.mjs \
  tests/integration/m02-gross-parity-workerd.spec.mjs
```

The tests write only to synthetic local databases. The gross-parity suite
applies all 14 numbered migrations locally and verifies the absence of
Party financial-account tables. Source and migration scans are read-only.

## Resume from a new chat

Read this file and [the clean-shop checkpoint](../CLEAN_SHOP_HANDOFF.md).
Check #707 against current main. The worktree for this evidence branch is
`/tmp/shererp-run3-gate` when it still exists on the owner's machine. The
canonical branch is `integration/purchase-gate-evidence`. Run 3 can continue
when M02/M08 approve the purchase-specific identity, cost and gross-account
contract. Start the integration test on the reviewed schema with the two
purchases above. Require stable PUR/LOT/SM/SLD references, current SQL
authority, simultaneous and changed-intent retry, a failed final ledger
leg and restoration of the original lot. Record the actual failing reason
before introducing operational SQL. Staging activation remains a separate
owner decision.
