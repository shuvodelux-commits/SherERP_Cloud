# M06 Split Sale Update Preview — Superpowers TDD plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development, with red/green GitHub evidence.

**Goal:** Source-exact preview of split invoice editing totals and proposed payment allocation without touching D1 or bookkeeping.

**Architecture:** Compose existing `planSaleUpdateLineTotals` and original port `normalizeSalePayments_`. Frozen GAS functions run independently in a Node VM reference fixture; no duplicate money engine.

**Spec:** `docs/superpowers/specs/2026-11-15-m06-split-sale-update-preview.md`

**Required source:** frozen Mohim_ERP `SalesManagement.gs` + `SalePayments.gs` + `Utils.gs`; target `AGENTS.md`, migration plan, ADR-007, M06 workstream.

### Task 1 — Test-only source oracle and RED commit

- [ ] Create `tests/fixtures/m06-split-sale-update-oracle.mjs`, verifying Git blob hashes of all three original files and executing the original named GAS methods through Node vm (no production imports).
- [ ] Create `tests/m06-split-sale-update-preview.test.mjs`: real source parity for fixed original decimal line, changed price, Cash+Bank change, incomplete tender, zero-total/discount, Mobile Banking active account, no duplicate products, missing/mismatched invoice, invalid non-v1 and cost access permissions. Ensure pure immutable inputs.
- [ ] Commit tests BEFORE implementation and open a draft PR to trigger GitHub Foundation. Inspect genuine failed missing-module import **RED**; do not fake success.

### Task 2 — Minimal green implementation

- [ ] Create `src/modules/split-sale-update-preview.js` with one exported pure function `planSplitSaleUpdatePreview`.
- [ ] Compose existing modules only, validate plain, snapshot-shaped trusted inputs, enforce exact Sales ID & version 1 (no legacy conversion), `canEditSales===true`, nondeleted header.
- [ ] Follow source discount and `roundMoney_(grandTotal)` rule and call native port `normalizeSalePayments_`. Return source-shaped prediction only; no database/UI/RPC/auth changes.
- [ ] Run GREEN GitHub Foundation with all native source parity tests, inspect job logs.

### Task 3 — Integration safety and review

- [ ] Verify full GitHub exact-head node/source/frontend, M01 Chromium, M02/M04 local Workerd/D1, M03 aggregate and Worker preview safety.
- [ ] Review changed files, live PR state and CI; document no public activation, no financial writes, remaining cross-module gates.
- [ ] Leave PR draft/unmerged until owner explicitly approves and every exact-head workflow completes successfully.

**Files:** exactly five additive files (spec, plan, test-only source oracle, test file, pure module). No shared D1 kernel, auth, stock, bank, original UI or migrations.
