# M03 Run 4A — Synthetic Oversold Settlement Atomicity Proof

**Status:** Nondeployable, test-only Workerd/D1 contract. **NOT** actual ERP posting, no remote DB mutation, migrations, public RPC or original GAS edit.

**Date:** 2026-11-19 (Asia/Dhaka)  
**Main base at branch creation:** e31dd1e929e6f7857cc1bb8896bb8abf70ae2c09  
**GitHub workstream:** M03 shared database integration owner; previous M05 Runs 1–3 merged.  
**References:** [M03 gate](../M03_PARALLEL_READINESS.md), [parallel rules](../PARALLEL_EXECUTION.md), [design](../superpowers/specs/2026-11-19-m05-oversold-lot-cost-parity-design.md), [implementation plan](../superpowers/plans/2026-11-19-m05-oversold-lot-cost-parity.md), issues #22/#66/#314.

## Scope and implementation

The work introduces an isolated disposable SQLite schema and contract under \`tests/fixtures/\`, a Node SQLite suite, a local Workerd/D1 fixture with a *fake* D1 UUID, and Workerd integration tests registered in the existing M03 aggregator. No \`src/db/**\`, \`src/rpc/**\`, \`migrations/**\`, production Worker, source GAS, UI, Cash/Bank, Party, or real database files are touched.

**API shape (test only):** \`createSyntheticOversoldSettlementProof(DB).settle({...})\` requires a fixed approved fixture actor, token digest, tenant, operation ID, product, purchase lot, expected lot revision and exact array of negative lot IDs + expected versions + remaining quantities. It returns \`COMMITTED\`, \`REPLAY\`, \`CONFLICT\`, \`DECLINED\`, or throws \`NEEDS_REVIEW\` on an uncertain D1 error.

One \`INSERT ... SELECT ... WHERE EXISTS(current D1 session + active user + active authorized role)\` claims an immutable receipt only when its product/purchase lot, debt lots, source dates, existing debt, tenant and expected revisions all match within the same SQL statement. A synthetic trigger updates the positive lot and **all negative lots together**, inserts immutable source-linked allocations and a nonposting variance audit. A deliberately failed late audit insertion aborts the entire SQL statement, including both lot updates and the receipt. Duplicate operation hashes and stored receipts support exact-once readback. This is a *synthetic transaction acceptance experiment*, **not a complete historical settlement posting service**.

The integer unit/cost fixture is deliberately restricted: 240 synthetic Foot at 6,475 paisa, previously oversold -229 and -2 Foot at 6,800 paisa, results in 9 unsold Foot, an original purchased quantity of 240, 231 settled Foot and +75,075 paisa provisional cost-variance evidence. The missing 2 Foot in the real user's screenshots remain **unverified**. The proof does not import or repair that record.

## TDD evidence and CI

1. **RED:** \`node --test tests/m03-oversold-atomic-proof.test.mjs\` failed with \`ERR_MODULE_NOT_FOUND\` before the contract/schema files were created.
2. **GREEN:** after the smallest test-only D1-style SQLite contract and schema, Node 22.16.0 \`node --test tests/m03-oversold-atomic-proof.test.mjs\`: **9 tests passed, 0 failed**.
3. The first GREEN run exposed one invalid test expectation: duplicate allocation IDs are rejected by the input validator with a TypeError before SQL; after correcting the test to assert rejection, **9/9 passed**. No production data was affected.
4. \`node --check\` passed for all three new JavaScript fixture/integration files.
5. The Workerd+D1 suite is registered in \`tests/integration/m03-workerd.spec.mjs\`. **Actual Workerd execution and exact-head GitHub CI must be reviewed on the PR before merge.** The isolated container did not have Wrangler installed; never represent Node SQLite results as actual Workerd evidence.
6. GitHub blob SHA verification matches the exact locally tested Node fixture/test files:
   - contract \`296c3fa610a42aae965b39bc8ae2a4ed685bb637\`
   - schema \`3c7d215ddf997ee6c287d7651cccecb8a6173fef\`
   - Node tests \`43e7885e7c1bf0f0bf58cecc42c0e898024255b9\`

### Tested cases

- 240 positive with 229+2 negative reconciles to 9, with unmodified original purchase 240.
- Exactly one immutable operation receipt, two links and one audit entry.
- Same operation replay does not allocate twice; changed intent conflicts.
- Stale positive revision, stale negative remaining, backdated debt, bad product and duplicate debt ID fail closed.
- Late synthetic audit abort rolls back all lot/receipt/link effects.
- Cross-tenant forged snapshot, revoked/expired role/session/user status denied in SQL.
- Two racing operation IDs for the same shortage result in at most one commit.
- Committed receipts and links cannot be edited/deleted.
- Accessor properties and unexpected input keys are rejected before SQL.

## Remaining release blockers

**DO NOT ENABLE:** No reviewed source-fidelity row reconciliation, no base-unit stock conversion for fractional Foot/Tile Sqft, no exact-once M07 purchase/sale return reversal, no M08-approved balanced variance posting, no M02-P Party account parity, no production M04 session authorization integration, no full production M03 repository/write kernel, and no audited historical repair.

### M08 accounting policy decision required

For a hypothetical replenishment of 231 oversold Foot with provisional COGS at BDT 68 and new purchase cost BDT 64.75, the difference is favorable **BDT 750.75**. M08 must decide and prove the **balanced** treatment of inventory asset, prior provisional COGS and signed variance at an explicitly approved accounting date. It must not silently edit original invoices or create Cash/Bank/Supplier transactions. A missing accounting policy leaves future real posting blocked even when this synthetic proof is green.

### Next required gate

Independent Super QA → Super Review of exact PR source and real Workerd/D1 results. M03 owner documents full M02/M03/M04/M07/M08 readiness; only a separate approved production schema and posting PR can integrate actual ERP data after all gates are signed.
