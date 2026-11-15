# M07-A1 — Cash Return Atomicity Proof

**Status:** bounded, internal test-only proof; not a Worker RPC or deployable accounting subsystem.
**Source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` and merged M07 contract.
**Inputs:** merged M06 synthetic `m06_invoices`, `m06_sale_items`, `m06_stock_movements`, `m06_owned_stock`, `m06_cash_sessions`, and immutable source operation hash.

## Intent
Show that a single-invoice Cash return linked to the original sale and explicit owned-lot provenance can commit stock and cash-out together, once, while never silently reducing customer due. Cash refund remains possible on a fully unpaid source invoice.

## Approach
A test-only M07 table overlay references M06's local-D1 fixture, with pre-seeded fake original consumption evidence (not a migrated M05 lot). An internal, trusted-harness-only method `createSyntheticD1CashReturnContract(DB).post(input)` fingerprints return intent using the existing M03 canonical digest. A single guarded D1 INSERT with an `AFTER INSERT` test trigger increments provable returned quantity, source-linked lot availability and M06 owned stock, writes inverse stock movement and records one Cash refund debit. A same-batch lookup classifies COMMITTED, REPLAY, CONFLICT, DECLINED; uncertainty is NEEDS_REVIEW. Both SQL guard and mutation check quantity and session state. All mutations roll back on a failing cash or stock child.

## Rejected
- JS preflight followed by separate async writes: stale reads/partial posting.
- New production correction engine: violates native module architecture.
- Converting M06 Customer due to nonnegative-only Store Credit: not source-faithful because original credit can yield a signed due/advance. Store Credit requires reviewed M08/Party account design.
- Inferring returned lot from current FIFO: original consumption link is mandatory.

## Limits
Single standard SKU, integer owned units, one proven synthetic lot per invoice, Cash refunds only, original price ceiling represented as an exact integer-paisa ratio, synthetic trusted actor and no real M04 permission, source returns UX or batch semantics. No split-payment individual return journal, vendor/bundle/OVERSOLD, historical date policy, actual M05 lot transition, Store Credit, supplier obligations, Cash Session lifecycle, or real staging schema. Never expose a route to this fixture or infer `PARALLEL-MODULE-READY` from it.

## Acceptance
Real Workerd/D1: one partial and full Cash return, paid and fully due source, replay/conflict, concurrent last unit, stale Cash Session, missing source evidence and child fault atomic rollback. M06 original `customer_due` and supplier payable must remain unchanged. No public RPC, production migration, deployment Worker, D1 secret or changes to frozen source.
