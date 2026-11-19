# M07 Run 5A — Settlement-linked return and purchase correction preflight

**Date:** 2026-11-19 (Asia/Dhaka)
**Workstream:** M07-only preparation, issue #314.
**Base:** verified GitHub main d2eb67d4ec58202bd4316d67005ccca3419b9514.
**Scope:** pure read-only correction proposal, test-first. **No production D1, migrations, source GAS, UI, POS or financial posting.**

## Background and root cause

M05 Run 2 can propose settlement links between old negative stock and new purchased inventory. Run 3 limits the read-only FIFO view to net stock. M03 PR #693 has merged an **isolated synthetic** D1 receipt/settlement proof, not a production writer. It currently stores purchase-lot and oversold-lot links but **does not persist \`sourceSaleItemLotId\`, correction/reversal quantity or source-sale lineage**. That is a hard release blocker for safely undoing historic sales. No product/date-based guessing or retroactive changes to posted SALE_ITEM_LOTS are permitted.

## Implementation contract

\`planSettlementReversal({...})\` consumes an explicit trusted, same-tenant, same-product snapshot of:
- a purchased lot including \`originalQtyTicks\`, \`availableQtyTicks\`, \`otherConsumedQtyTicks\` and previously returned purchased quantity;
- unique existing settlement links, \`allocatedQtyTicks\`, already reversed quantity and cumulative reversed provisional and actual costs in integer BDT paisa, **original \`sourceSaleItemLotId\`** and \`oversoldLotId\`;
- the original source sale-item-lot or purchase identifier, original quantity, quantity previously returned, exact correction, and committed prior corrections.

All quantities are canonical **integer base-unit ticks**, with an explicit \`quantityScale\` validated upstream. Fractions are not inferred. Result is one of \`CANDIDATE_ONLY\`, \`REPLAY\` or \`NEEDS_REVIEW\`, **always \`postable:false\`**. It never emits a financial journal, Cash/Bank/Party posting or editable database row index. Unsupported source evidence blocks an allocation.

### Proposed sale return semantics — non-postable until M03/M07/M08 approval

For a fully source-linked prior oversold sale, an exact partial sale return has **two conceptual steps**:
1. Undo the corresponding portion of previous settlement: purchase lot availability +Q, negative oversold outstanding -Q, net stock delta = 0.
2. Apply the original sale return inventory restoration through the M07 source-linked return mechanism: total net stock delta = +Q.

The planner describes these two separate steps so the M03 integrator cannot mistake a virtual reversal for a completed physical stock return. Source item and lot IDs must be proven and exactly once; changes to historic sale invoice totals and previously posted COGS **must not be silently applied**. For a settlement link with partial previous reversals, the cost reversal is the incremental difference between cumulative integer-paisa allocations, avoiding multi-return cent drift.

### Proposed purchase return/delete semantics

- Purchase return is **CANDIDATE_ONLY** solely for quantity remaining genuinely unallocated in the purchased lot. With original 240, 231 funding old oversold and 9 remaining, returning 1 may be proposed, returning 15 must fail \`FUNDED_STOCK_RETURN_BLOCKED\`.
- Purchase deletion is blocked whenever active historical settlement links, other consumption or prior purchase returns remain; only fully unallocated and untouched purchases may be proposed for further M07 native delete checks.
- A committed prior operation with matching stable identity/intent is returned as \`REPLAY\` without new deltas. A repeated ID with changed quantity is a conflict, not a refund. Pending, duplicated or missing correction history returns \`NEEDS_REVIEW\`.

## Test evidence and limits

- RED: deliberate new-module-absent \`node --test tests/m07-settlement-reversal-plan.test.mjs\` failed \`ERR_MODULE_NOT_FOUND\`.
- GREEN: local Node 22.16.0 test suite: **21/21 passed**, covering sale/purchase correction, residual stock, cost variance, exact source IDs, partial returns, replay, ambiguity, tenant isolation, malformed snapshots and safe-integer overflow.
- TDD mutation: altered purchase return guard from unallocated available quantity to original bought quantity; test for returning 15/9 failed; restored code passed 21/21.
- Local scratch source/test files and GitHub-uploaded files are not byte identical; this focused result is not a substitute for **exact PR-head GitHub CI**. Review CI and the resulting PR diff before any merge.
- The planned \`tests/integration/m07-settlement-reversal-workerd.spec.mjs\` is **not yet added**; full source-linked D1 integration would be a separately authorized M03-owned write contract. Do not claim full Run 5 or ERP return completion.

## M08 accounting policy handoff — requires express financial sign-off

If an actual stock-ledger journal posted provisional COGS when selling oversold inventory, settlement of 231 units provisionally costed at ৳68 by replenishment purchased at ৳64.75 yields **+৳750.75** potential favorable variance. Under *that specific accounting system only*, a possible balancing entry is:

- Debit Inventory Asset ৳750.75
- Credit COGS / COGS Variance ৳750.75

This reconciles a hypothetical negative inventory value of -৳168 to the residual +৳582.75. **It must not be posted on inference alone.** M08 must prove actual source postings and decide adjustment date, reversal account, rounding, audit actor, cost policy and historical report implications. If the original source did not post provisional Inventory/COGS ledger entries, applying the above journal would be wrong. No Cash/Bank/Supplier/Customer or sales-income entry is implied.

A linked sale return may require reversal of a previously posted variance, but the correct balancing entries depend on whether the return's underlying COGS and stock movement have already been reversed. M08 must define a double-entry table of journal effects for sale return/purchase return/delete; unapproved actions remain blocked.

## Hard release gates

1. M03 synthetic fixture PR #693 links do not carry sale-item provenance or prior reversal totals. Design an **append-only reversal-event schema** owned by M03, from which aggregates are computed; immutable original settlement links should not be updated/deleted.
2. M07 native source linkage with \`SALE_ITEM_LOTS\`, exact returns, purchase edits/deletes and concurrent source correction evidence is required.
3. M04 server-derived actor + tenant + permission proof **inside the same SQL write**, not from frontend inputs.
4. M08 reviewed variance and reverse-journal account policy. Distinct Party role accounts and Cash Sessions must remain unchanged except approved source transactions.
5. Local real Workerd/D1 fault-injected exactly-once reversals, idempotency, concurrency, permission denial, no partial mutations and failed commit readback.
6. M02/M03/M04 full readiness PR, historical import reconciliation, backup, dry-run, independent Super QA/Review and owner approval before any production data correction.

This is a module-only preparation contract, not authorization to change the current live Mohim_ERP Apps Script or production Cloudflare D1.