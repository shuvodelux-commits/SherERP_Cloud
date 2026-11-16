# M10-04 — Source-to-D1 Expense Categories digest parity

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracking:** #312. **Prerequisites merged:** M10-02 #316, M10-03 #330, M02 Expense Categories #325.

## Problem
M10-02 verifies source-shaped row and original-ID digests on local Workerd/D1 for `PRODUCT_CATEGORIES` and `PRODUCT_UNITS` only. M02 now has a reviewed, source-pinned `EXPENSE_CATEGORIES` offline importer and real local D1 readback. Its source description, status, time, duplicate name and original-ID behavior should receive the same independent M10 parity evidence.

## Design
Extend the existing pure `summarizeM10Catalog({inventory,sheetKey,rows})` allowlist by exactly one reviewed source master: `EXPENSE_CATEGORIES`. The reviewed `verifyExpenseCategoryMapping` and `prepareSourceExpenseCategories` APIs are reused without changing M02 code. Preserve M10-02 canonical hash format: `SHA256(JSON.stringify(['M10-ROW-v1',sheetKey,[[legacy_sheet_row,category_id,category_name,description,status,created_at],...]]))` and the distinct source-ID digest `SHA256(JSON.stringify(['M10-ID-v1',sheetKey,[[legacy_sheet_row,category_id],...]]))`. No private data or hashes in logs; errors remain the fixed `M10 catalog digest invalid` string.

Prove actual persistence in a new **local-only Workerd/D1 integration test** using existing M02 importer and existing `wrangler.m02-expense-categories-test.jsonc`. Query D1 via fixed-identifier SQL in the test and independently project the readback to original source headers, including original physical positions. Compare all three digests fields; direct SQL modification of **description only** must change `rowDigest` but not `idDigest`, and direct SQL replacement of original `category_id` must change both. Check missing/deleted rows, source data immutability and absence of exposed HTTP routes. Add this test as a new step to the existing PR-only M10 Workerd CI workflow.

## Explicit constraints
- Source exports/live Sheets, production D1 and new migrations remain forbidden without separately approved owner procedure.
- No financial relationships, Party roles, customer ledgers, cash book or M02 posting kernel changes; Expense Categories is a *master table*, not expense transactions.
- No RPC/auth/frontend changes, no publicly bound D1 preview. Do not broaden to 49 groups or claim real source data imported.
- Invalid source rows, malformed fields, duplicate IDs, wrong physical positions, malicious getters and unsupported groups must fail closed. Existing empty-snapshot rejection is preserved; don't silently certify zero rows.
- M10-03 two-pass source freeze and M10-01 49-group gate remain required, and `authorizesImport=false`, `productionReady=false` unchanged.
- The hashes are computed on operator-provided source-shaped rows and separately queried local D1 readback. They do not authenticate live GAS exports or establish business-level reconciliation.
- Rollback: revert this single PR. Draft PR and exact CI evidence required before owner merge.

## Alternatives
1. **Chosen:** reuse M10-02 stable digest format and M02 Expense Categories preflight; one test-only local D1 adapter.
2. Generic digest importer for all 49 groups: premature without reviewed schema/ID and financial mappings; rejected.
3. Trust only M02 one-shot import's postcommit comparison: misses independent canonical hashing and later persisted drift; rejected.
