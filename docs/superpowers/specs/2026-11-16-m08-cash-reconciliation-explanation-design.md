# M08 — Cash Reconciliation Explanation Read Model

**Source:** Frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2, `CashReconciliation.gs:cashReconciliationEvaluate_` and its helpers.
**Decision:** Implement source-faithful, internal read-only explanation evaluation, with synthetic test oracle. This does not enable financial posting, D1 writes, public RPC, cross-role settlement, or session transition.

## Intent and boundaries

Cash/session counting differences must be explained by existing real Cash Book entries, rather than synthetic cash movement. A pure read model accepts an explicit difference, previously linked entry IDs, and already-loaded Cash Book rows. It reports exactly the legacy fields `state`, `requiredDirection`, `requiredAmount`, `linkedAmount`, `remainingAmount`, and `entryIds`. It never links entries or writes to D1.

## Alternatives considered

1. New D1 reconciliation writer: rejected until shared M03/M04/M06 posting, identity, and authorization gates are reviewed.
2. Rely solely on a synthetic test of original GAS: preserves a baseline but supplies no reusable Worker read projection.
3. **Selected:** small source-parity read projection, checked against frozen GAS execution, no side effects or new dependencies.

## Behavioral rules

- Historical baseline returns `Baseline`; missing difference returns `Open`.
- Zero difference without linked IDs is `Balanced`; zero difference with linked IDs is `Needs Review`.
- Positive difference requires positive net Cash Book credits (`Cash In`), negative difference requires debits (`Cash Out`).
- Exact, valid matching real entries yield `Explained`. Deleted, synthetic, absent, zero, wrong-direction, underlinked, or overlinked entries cannot yield `Explained`; remaining amount never becomes negative.
- Linked IDs accept original CSV, newline, JSON array or array formats and are de-duplicated in original order.
- Inputs must be loaded synchronously and not accidentally Promises; source row objects must not be mutated.

## Release gate

This is an internal pure projection only. It is **not** authorization, data import, a real Workerd/D1 integration test, concurrency proof, ledger reconciliation, full Cash Reconciliation UI, or permission to enable cash/bank posting. Real financial changes require owner review and atomic, idempotent D1 transactions plus cash-session policy and reconciliation tests. Source `legacy/source/**`, existing UI and RPC remain unchanged.
