# M03 — Source-shaped Product Category/Unit Creation Preflight (Read-only)

**Source authority:** frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, `legacy/source/ProductSettings.gs::addProductCategory/addProductUnit` and `Utils.gs::sanitizeInput_`. **Existing repository:** `src/db/legacy-catalog-read.js` source-shaped awaitable rows, with physical row index validation. **Readiness:** internal M03 preparatory logic only; no external auth RPC.

## Why

The original add-category and add-unit functions trim incoming names, compare them case-insensitively with trimmed stored names, and reject any matching active master (where `String(Status || 'Active').toLowerCase() === 'active'`). If matching rows are inactive or have other non-active statuses, original source deletes those physical rows before issuing a new ID and appending an Active master. A naive async port would delete preexisting catalog records based on an obsolete name query, or issue a source ID without a successful atomic cleanup+insert. First extract and source-test the **decision only**.

## Internal API and exact behavior

Introduce `src/modules/product-master-create-preflight.js` exporting `createProductMasterCreatePreflight(env)` with `checkCategoryName_(name)` and `checkUnitName_(name)`. Each method returns a Promise of one of:
- `{canCreate:false,message:'Category name is required.'| 'Unit name is required.',name:'',cleanup:[]}` for blank/whitespace names.
- `{canCreate:false,message:'A category with this name already exists.' | 'A unit with this name already exists.',name:<trimmed>,cleanup:[]}` when any exact casefolded/trimming match has active or blank status (source fallback).
- `{canCreate:true,name:<trimmed>,cleanup:[{sourceId,rowIndex,name,status},...]}` for zero active matches, including no matches. Cleanup order is the source's physical row order, and represents all matching inactive/nonactive source records, not executable delete instructions.

The existing source `sanitizeInput_` converts other values to strings; the new internal API intentionally **requires string input** to prevent arbitrary object-to-string coercion or accidental external misuse. It must reject malformed source rows and only use source-validated physical indices from the existing D1 read adapter. `getAllRows_` is awaited exactly once per preflight. Matching uses JavaScript source `trim().toLowerCase()`, not SQLite `COLLATE NOCASE` (which is not Unicode-equivalent for Bangla and other scripts). No cached mutable rows. A matching source ID must be a nonblank string; if duplicate IDs or other unsafe cleanup provenance occurs, fail closed rather than return a plan that could target the wrong row.

**Critical contract:** a preflight is advisory and inherently TOCTOU-prone; *never* execute its cleanup based solely on a preflight read. Future approved create must combine source ID allocation, duplicate status check, guarded cleanup/compaction and append in one D1 transaction with current-state SQL guards. No partial mutation or promise leaks. A preflight MUST NOT invoke `generateId_`, any update/delete/append adapter, `DB.batch`, mutations, or external GAS.

## Evidence and safety

- Source VM oracle runs the actual frozen `addProductCategory`/`addProductUnit` in an isolated sandbox with explicit fake lock and sheet operations; compare status decisions and source-ID delete candidates for normal, duplicate active, blank-status-as-active, Unicode/trimming, and inactive duplicates.
- Node `node:sqlite` adapter tests prove Promise is awaited, one fixed SQL SELECT is used, no mutations, no full Settings/Party/Cash/Bank disclosures, invalid rows and D1 failures fail closed.
- Real **local-only** Workerd D1 tests run a fixed-name GET route against existing synthetic Product Category/Unit catalogs, with a non-active duplicate and an active duplicate; verify read-only rows unaffected and the route never accepts untrusted name or SQL identifiers.
- Test-first RED commit expected to fail with `ERR_MODULE_NOT_FOUND`. Then minimal GREEN implementation. Original 84 source files and 36 HTML includes, 10 repository CI workflows must stay green.
- Changes restricted to two new docs, one new internal module, one new unit test, test-only Worker route and real local M03 integration tests. No numbered D1 migrations, existing SQL adapters, production RPC/Worker, frontend, source files or production/staging D1 writes. **Rollback:** revert the isolated PR.
