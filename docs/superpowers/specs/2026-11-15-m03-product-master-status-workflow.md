# M03 — Source-shaped Product Category/Unit Status Workflow (Internal D1 only)

**Source of truth:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` — `ProductSettings.gs::setProductCategoryStatus` and `setProductUnitStatus`, `Utils.gs::ok_` and `fail_`. The two already-reviewed master tables and existing read/update/delete D1 adapter primitives are reused without schema edits.

## Problem and boundaries

Read, update and delete catalog primitives independently pass unit and Workerd tests, but the original ProductSettings status method's **read-by-stable-source-ID → choose activate or permanently delete → return source-shaped result** has not yet been ported as one awaited internal workflow. A naïve Sheet-row index from before the read or an unguarded update can instead update a different catalog row when concurrent requests compact Sheet positions.

Implement `src/modules/product-master-status-workflow.js` as an internal-only adapter `createProductMasterStatusWorkflow(env)` exposing `setCategoryStatus_(sourceId,status)` and `setUnitStatus_(sourceId,status)`. No session/token input and **no public RPC activation**: the M04-authenticated application service must later gate every call with `products.edit` before reaching these privileged methods. Unlike public methods, these cannot be directly invoked by external traffic.

The caller supplies an original source ID string and one of two explicit UI statuses: `'Active'` or `'Inactive'`. Unknown statuses fail closed and **never delete** even though the frozen source's `status !== 'Active'` would delete on arbitrary arguments. This is an intentional API-boundary hardening, not a change to supported original UI behavior.

For each call: await `createLegacyCatalogReadAdapter(env).findRow_(SHEET,'Category ID'/'Unit ID',sourceId)`, requiring real `_rowIndex`, exact stable source ID and current name/status. If no matching record, return original envelope `{success:false,message:'Category not found.'}` or `'Unit not found.'`. If requested `'Active'`, await `createGuardedCatalogUpdateAdapter(env).updateRowFields_(SHEET,rowIndex,{Status:'Active'},{sourceId,name,status:oldStatus})`, then return `{success:true,data:{id:sourceId,status:'Active'}}`. If requested `'Inactive'`, await `createGuardedCatalogDeleteAdapter(env).deleteRow_(SHEET,rowIndex,{sourceId,name,status:oldStatus})`, then return `{success:true,data:{id:sourceId,deleted:true}}`. Existing D1 SQL CAS/source identity and transactional compaction protect stale read races. **Never** swallow a D1 exception into a success envelope, or reread/retry after an ambiguous write; fail closed and reconcile original source identity first. No module-level mutable cache.

## Acceptance tests

- Node SQLite-backed oracle invokes actual frozen `ProductSettings.gs` functions with safe source UI status values and compares result envelope, update versus permanent-delete semantics, including original physical row shift, name+ID preserved on activation, no reassign of compacted next row, and no effect on other master table.
- Strict source ID/status input; no arbitrary sheet/table SQL, no prototype/array injection, missing DB or transaction binding refuses before any writes; not-found returns source error; D1 read/SQL failure rejects, not forged success.
- Stale read injected between read and guarded CAS cannot overwrite/delete another row; two concurrent identical delete or activation requests at most one succeeds, and complete batch rollback after forced compaction error.
- Real **local-only** Workerd D1 fixture with isolated config and fixed server-side routes; no public Worker or deployed D1 changes. Verify category inactive status triggers deletion/compaction; unit Active status updates exactly one row; stale replay fail; unknown request body ignored; source ID/row provenance fails closed.
- Keep original pinned 84 source files, 36 HTML includes, existing M02/M03/M04 local integration and Chromium checks green. RED commit must show missing new module before GREEN implementation.

## Constraints and remaining gates

Changes limited to two docs, one new internal module, one new Node test, one new test-only Worker, one new test Wrangler config, one Workerd integration test, and a single additive import in the existing M03 integration aggregator. **No migration**, no editing frozen source/UI, no `src/rpc` or deployed `src/index.js`, no remote D1, no real Party/Cash/Bank/stock mutation. Full Products operations and authenticated public `setProductCategoryStatus`/`setProductUnitStatus` still require M04 permission-gated integration and source-ID import/cutover review.

**Rollback:** revert this isolated PR; none of these changes mutate any live D1.
