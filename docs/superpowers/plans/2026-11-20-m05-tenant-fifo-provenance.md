# M05 Tenant-Scoped Purchase & FIFO Provenance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Audit one trusted tenant's purchase, physical stock, supplier-lot and FIFO evidence without creating any posting authority.

**Architecture:** New M05-only read-only composition gate. Reuse existing M05 frozen-source auditors for purchase-lot lineage, purchase movement deltas and cached-stock/lots parity; only quote net-owned stock with the existing provisional FIFO preview. Require explicitly scoped trusted source snapshots before invoking any audit, rather than silently filtering a foreign-tenant record.

**Tech Stack:** Node >=22, ES modules, node:test, existing M05 modules, GitHub Actions. No dependencies.

**Spec:** GitHub issues #314 and #456; AGENTS.md; docs/PARALLEL_EXECUTION.md; docs/M03_PARALLEL_READINESS.md; source Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.

## Global Constraints

- Exclusive source changes: `src/modules/m05-tenant-fifo-provenance-audit.js`, `tests/m05-tenant-fifo-provenance-audit.test.mjs`, this plan.
- Never edit shared D1/schema, migrations, RPC/Worker, financial kernel, original UI, protected workflows or remote data.
- Explicit tenant/product ownership; never infer supplier → Party identity, normalize original IDs, round money, change purchase date ordering, or create stock writes.
- M03 owns authoritative auth+SQL atomic posting; M02 supplier/Party links; M08 financial cost variance and rounding approval.
- Source parity is a **snapshot characterization**, not fresh/authorized business data, and never becomes a production API.

## Review Focus

1. Two tenants sharing a Product/Lot/Purchase ID must never contaminate evidence.
2. Purchase lot supplier disagreement must never be made into a guessed Party link.
3. Negative OVERSOLD alongside a replenishment lot must not expose gross stock as sellable.
4. A duplicate source movement or lot must not be silently counted twice.
5. Snapshot getters, bad input quantities and mismatched product IDs must fail closed.

## Task 1: Isolated RED Acceptance

**Files:** Create `tests/m05-tenant-fifo-provenance-audit.test.mjs`.

**Interface:** `auditTenantPurchaseFifoEvidence({tenantId,productId,requestedQty,productRow,purchases,purchaseItems,stockLots,stockMovements,vendorSourced?})`.
Required output: `{auditPassed,issues,stock,lotLineage,purchaseMovements,fifo,postingAllowed:false}`.
Every row has a trusted normalized `'Tenant ID'`, and per-product arrays are explicitly scoped. `fifo` is null when evidence is blocked.

- [ ] Write tests using two-supplier/lot same-day FIFO, first original-date priority, non-mutating snapshots, cached stock, purchase movement conservation, oversold provisional reserve and insufficiency.
- [ ] Write rejected cases: cross-tenant/cross-product, source IDs, broken supplier provenance, duplicates, deleted lot, ambiguous oversold, invalid quantities and accessors.
- [ ] Commit tests **without** production module.
- [ ] Verify real RED using GitHub Actions Node test runner, expecting missing new M05 module (not an unrelated failure); capture run URL/commit SHA.

## Task 2: Minimum GREEN Composition

**Files:** Create `src/modules/m05-tenant-fifo-provenance-audit.js`.

- [ ] Validate all trusted arrays and values are plain, dense and own-data; reject accessors, missing tenant/product IDs and nonfinite request.
- [ ] Never auto-filter foreign tenant/product rows: add blocking scope issues and skip every downstream planner on scope failure.
- [ ] Reuse `auditPurchaseLotLineage`, `auditPurchaseStockMovementProvenance`, `auditSourceStockLotBalances`; propagate their issue codes without rewriting arithmetic.
- [ ] Reuse `planNetOwnedStockPreview` only after stock + lineage + purchase/movement audits pass; convert its review-only failure into a blocked preview, never a consumption/write plan.
- [ ] Run focused `node --test tests/m05-tenant-fifo-provenance-audit.test.mjs` (GREEN).
- [ ] Run `npm test`, `npm run verify:source`, relevant original parity and Workerd/D1 workflow jobs; capture exact results.
- [ ] Inspect resulting diff for only the three permitted paths; review original source identity and M02/M08 dependencies.

## QA → Review → PR

- [ ] Independent /super qa checks tenant isolation, duplication, real-source distinction, missing rows, sum/product fidelity and no public route.
- [ ] Independent /super review checks minimal KISS composition and test RED/GREEN traces; identify any review limitation explicitly if no separate reviewer is available.
- [ ] PR into main with changed file inventory, source SHA, RED and GREEN evidence, exact CI checks, blockers and human-approval-only merge gate.
- [ ] **Do not merge**, deploy, touch remote D1 or claim transaction readiness.
