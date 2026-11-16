# M05 — Source-faithful Purchase Update form read model (2026-11-16)

**Source:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `PurchaseManagement.gs::getPurchaseForUpdate`, `StockLots.gs::lotSellPrice_`, and the separately guarded `PurchaseManagement.gs::updatePurchaseInternal_`. **Target:** `shuvodelux-commits/SherERP_Cloud` current `main`; `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, `docs/M03_PARALLEL_READINESS.md` and ADR-007 are mandatory. Distinct from open #372 Purchase History and #313 multi-unit contract.

## Thirteen-sentence overview

1. The frozen Purchases page has an Update form that calls `getPurchaseForUpdate` after a trusted `purchase.edit` permission check.
2. The original reader refuses missing, soft-deleted and purchase-return-linked purchases before presenting an editable form.
3. It returns the original Purchase ID, date, Supplier ID/name, discount, paid amount, payment method, bank account ID, notes and ordered purchase items.
4. A paid purchase with no stored Payment Method defaults to Cash, whereas an unpaid one has an empty method.
5. Each item's Selling Price uses its recorded Purchase Item sell-price when present, otherwise the purchase-specific Stock Lot sell-price, otherwise the product's selling price, or zero.
6. A stored explicit numeric zero is authoritative and must not be treated as missing.
7. Only the source purchase's rows may be considered when selecting its related lots and items.
8. The internal `projectPurchaseForUpdate` accepts only explicit already-authorized, tenant-scoped trusted snapshots and never reads a database or supplies the permission decision.
9. Tests will execute both frozen GAS functions in an isolated VM and compare the complete source payload including historical price fallback.
10. Ambiguous duplicate purchase IDs, duplicate product lines or multiple purchase lots for one product must fail closed rather than silently selecting an unrelated source row.
11. Missing product identifiers, invalid numeric values and ambiguous unnormalized purchase dates must block a migration edit preview.
12. Commit RED tests and verify a GitHub Actions missing-module failure, then add the smallest GREEN implementation and verify exact-head Node and CI.
13. Do not change M02 D1 schema, M03 posting kernel, M04 authorization, M07 return logic, original GAS/Sheets, Cash/Bank/Supplier ledgers, Worker RPC or UI.

## Scope and rollback

Add **three new files only**: `src/modules/m05-purchase-update-read.js`, `tests/m05-purchase-update-read.test.mjs`, this plan. No `src/db/**`, SQL migrations, `src/rpc/**`, `src/index.js`, `src/auth/**`, UI, frozen `legacy/source/**`, production data or Cloudflare bindings. The read model is not a command: no write, row locking, bank balance change, supplier due change, Cash Session bypass or public RPC. M03/M04 must later authorize purchase.edit before collecting snapshots and **recheck** editability and financial SQL guards in an atomic write boundary; the read preview can go stale. Multi-unit historical conversion snapshots and full returns/corrections remain gated by open #313 and M07. Revert three new files to roll back with zero accounting effects.

## Test-first acceptance

Use a fresh branch based on main, run frozen GAS in a VM for source oracle, prove exact output on normal/history scenarios and deterministic source-data ambiguity rejections. RED means actual `ERR_MODULE_NOT_FOUND` in GitHub CI, not a claimed local run. GREEN means full target checks on exact head, including legacy source integrity, Node suite and Worker safety; no merge until all are verified and owner reviews.
