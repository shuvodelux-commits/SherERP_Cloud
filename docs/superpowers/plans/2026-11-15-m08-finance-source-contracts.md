# M08 — Finance Source Contract Inventory Implementation Plan

**Spec:** `docs/superpowers/specs/2026-11-15-m08-finance-source-contract-design.md`
**Base:** fresh `main` at start of work; isolated `m08/source-finance-contracts-20261115` branch.
**Owner:** M08 read-only audit/test lane; shared `src/db`, SQL migrations and posting kernel reserved for M03 integrator.
**Source:** pinned `29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.

### Task 1 — RED: Test the safety contract
- **Create:** `tests/m08-finance-contract-inventory.test.mjs`.
- **Prove:** endpoint identities and permission surfaces, distinct role/finance type mapping, bank-transfer two legs, historical opening cash vs current session, Party-ledger role selector, source drift detection and deterministic snapshot.
- **Run:** `node --test tests/m08-finance-contract-inventory.test.mjs`.
- **Expected:** failure with missing analyzer (RED).

### Task 2 — GREEN: Source-only analyzer
- **Create:** `scripts/audit-m08-finance.mjs`.
- Parse selected frozen GAS modules with Acorn, inspect only declared top-level functions, never evaluate GAS.
- Emit per-endpoint direct calls/permission arguments/direct literal sheet reads+writes; capture explicit dynamic references without inventing resolved table ownership.
- Freeze exact finance transaction-type mapping and selected safety invariants by comment-independent token assertions.
- **Run:** `node scripts/audit-m08-finance.mjs --write` then focused tests.
- **Expected:** source inventory generated; focused tests green.

### Task 3 — Snapshot and independent verification
- **Create:** `docs/baseline/m08-finance-contract-inventory.json`.
- **Run:** `node scripts/audit-m08-finance.mjs --check`, `npm test`, `npm run verify:source`, `npm run build:frontend`, `node --check` on new JS and `git diff --check`.
- **Expected:** tests and static gates green; report any baseline or environmental failures rather than masking them.

### Interface and release rules
- Inputs: only pinned original `.gs` files and source-manifest SHA. Outputs: deterministic metadata (no customer data, names, phone numbers or transaction rows).
- Changed files: exactly analyzer, test, JSON snapshot, spec, plan. No shared runtime/DB/auth surface.
- No D1 migration or import; rollback is reverting this audit-only PR. CI and DB-free Cloudflare PR preview must pass before owner-reviewed merge.
- Later M08 tasks: approved account/id mapping -> session & bank journal posting kernel -> native Customer/Supplier/Vendor/Finance flows -> read ledgers and reconciliation -> exact-once corrections, gross parity and real Workerd+D1 fault-injection tests.
