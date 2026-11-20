# M05 Historical Unit → Purchase Item → Stock Lot Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Prove an explicitly trusted historical multi-unit/legacy purchase preflight is consistent with one original Supplier Purchase Item and Stock Lot per Product, without recomputing pricing from today's conversion catalog.

**Architecture:** An M05-owned, pure JavaScript review gate calls the existing `auditMultiUnitPurchaseSnapshot` and `auditPurchaseLotLineage`. It requires an independent, explicitly supplied source-unit receipt for every advanced unit line; the immutable receipt must equal the purchase-time snapshot, while original Purchase Item and Stock Lot identities, quantities, costs and supplier link agree with the preflight. It returns no operation/posting instructions.

**Tech Stack:** Node >=22 ESM and node:test; existing source-parity M05 modules; GitHub Actions. No new dependency.

**Spec:** issue #314 mixed-unit purchase historical snapshot and canonical-stock requirement; coordination issue #456; AGENTS.md; docs/PARALLEL_EXECUTION.md and docs/M03_PARALLEL_READINESS.md; pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, supplemental `sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c`.

## Global constraints

- Fresh base `main@2536640a9f6e6b6c409486b26e545c501cfa4a6a`.
- Exclusively new `src/modules/m05-historical-unit-lot-handoff.js`, `tests/m05-historical-unit-lot-handoff.test.mjs` and this plan.
- M03 owns shared `src/db/**`, `src/rpc/**`, migrations, Worker and SQL atomic stock/finance posting. M02 owns Supplier→Party source identity. M08 owns rounding/accounting policy.
- No production writer, worker entry point, asset/print UI changes, remote D1, historical import, supplier auto-link, current conversion lookup, receipt issuance or live operations.
- Source original decimal arithmetic is preserved by comparing already-stored rates and quantities; do not introduce a new currency rounding convention.
- This is a synthetic/trusted-snapshot contract only; it does **not** prove real historical supplementary unit receipts exist in the archival database. Missing receipt with an advanced unit line is `NEEDS_REVIEW`; legacy single-unit with no receipt remains valid.

## Input and return contract

`auditHistoricalUnitLotHandoff({tenantId,purchaseId,purchaseHeader,preflight,purchaseItems,stockLots,unitReceipts})`:
- `purchaseHeader`: source-named `'Tenant ID','Purchase ID','Supplier ID','Date','Is Deleted'`.
- `preflight`: existing `prepareMultiUnitPurchasePreflight` result including `supplierId`, `subtotal` and `lines[]`; each advanced `line.unit` contains `stockUnit`, `lineTotal`, `unitSnapshot[]`, `pricingSnapshot[]`.
- `purchaseItems`: one per Product ID, each source `'Tenant ID','Purchase ID','Product ID','Quantity','Unit Price'`.
- `stockLots`: source `'Tenant ID','Lot ID','Purchase ID','Product ID','Supplier ID','Purchase Date','Original Quantity','Remaining Quantity','Purchase Price','Status'`; source audit has the authority to validate quantity, unit cost and dated supplier association.
- `unitReceipts`: independently supplied original purchase historical unit snapshot records `{tenantId,purchaseId,productId,unit}`, one per advanced-unit line; **never** a current catalog lookup.
- Return `{ready,issues,unitAudit,lotAudit,checkedProducts,postingAllowed:false}` with issue codes and no D1 statements, mutation receipts, or new source IDs.

## Review focus

1. Counterfeit/mismatched original Product, Purchase, Supplier or Lot identities and duplicate records → block with explicit code; never infer Party identity.
2. An internally consistent 145-Pcs unit line that disagrees with stored Purchase Item or Stock Lot original physical quantity → block.
3. Changed unit-factor or component-price snapshots after the historical receipt is captured, even if a caller recalculates a plausible base stock quantity → block.
4. Missing advanced receipt must never fall back to treating the multi-unit product as legacy; a truly legacy line without receipt is allowed.
5. Cross-tenant, extra products, accessor rows, sparse arrays or nonfinite source amounts cannot be used as authority for a FIFO/financial writer.

## Task 1 — TDD RED source-bridge acceptance

**Files:** create `tests/m05-historical-unit-lot-handoff.test.mjs`.

**Test cases:** valid synthetic `1 Bag + 2 Box + 5 Pcs = 145 Pcs` plus ordinary 2-Foot Pipe, original `PUR-/SUP-/LOT-` lineage, frozen receipt matching preflight; post-sale lower `Remaining Quantity` is allowed; original source precision preserved; later current catalog change irrelevant; changed historical factor, price, original lot quantity, stored rate, Supplier/Purchase ID, tenant, duplicate receipt, extra source row and malformed input block.

- [ ] Write executable assertions from hand-checked source values; do not calculate expected quantities via the function under test.
- [ ] Commit RED without implementation module; run GitHub Actions and inspect logs for the exact intended missing module error on new tests (not an unrelated failure).

## Task 2 — Minimum GREEN internal audit

**Files:** create `src/modules/m05-historical-unit-lot-handoff.js`.

- [ ] Reject missing/unsafe input and accessor-bearing/sparse arrays **before** calling downstream source auditors.
- [ ] Reuse existing `auditMultiUnitPurchaseSnapshot` and `auditPurchaseLotLineage` without copying their conversion/lot algorithms.
- [ ] Require all evidence to belong to the one explicit Tenant/Purchase and one stored source Supplier, and each advanced unit to have exactly one trusted historical receipt.
- [ ] Compare source original quantity and unit rate without adding rounding policy; match independent historical unit receipts field-for-field (including all original keys) without mutating input.
- [ ] Return only review issues, no stock/posting instructions.
- [ ] Run focused Node tests, complete Github Foundation and entire current-head CI including Workerd/D1, M01 Chromium and source verification; distinguish evidence-only contract tests from operational posting proof.

## Super QA → Super Review → human approval

- [ ] Inspect 3-file changed path inventory, source invariants and hostile cases; document uncovered real-data gating and source supplementary limits.
- [ ] Review diff as a separate pass, then require independent human/code-review approval.
- [ ] Create/retain one draft PR into main. **Do not merge**, regardless of green CI, without explicit current-turn owner approval; never enable production D1 or public RPC. 
