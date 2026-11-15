# M03 — Atomic Product Category/Unit creation, isolated D1 proof

**Source pin:** Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2; ProductSettings.gs addProductCategory/addProductUnit, Utils.gs generateId_. Exact ID prefixes PCAT/PUNT, six-digit minimum. Source names trim and Unicode JS lowercase; blank Status counts Active. Frozen source and UI are never edited.

## Decision and boundary

Use an **internal, local-only** repository method and a **nondeployable D1 trigger schema**; this proves cleanup, sequential ID allocation and creation in the *same SQLite INSERT statement*. The existing M03 read-only preflight is advisory, never an authorization or commit guarantee. Do NOT chain its result to independent delete+counter+append requests. No production/staging migration, no public RPC, no live D1 binding, no Cash/Bank/Party or financial posting.

Create src/modules/m03-product-master-atomic-create.js exporting createM03AtomicProductMasterCreator(env,{businessId}). It offers createCategory_({operationId,name}) and createUnit_({operationId,name}). Business ID is trusted from the isolated D1 business context, not HTTP body. Operation IDs must be stable and server-approved; current module has **no public entrypoint**. Return original {success:true,data:{id,name}} on success and source-shaped duplicate/blank-name error envelopes; throw on stale/ambiguous D1 errors. Never silently retry with a new operation ID.

## Transaction

1. For stable replay, read the existing immutable operation receipt and compare its request hash and name. Identical replay returns same ID. Changed intent with same operation ID refuses before mutation.
2. Otherwise await the reviewed source-shaped catalog reader exactly once. Compare names with JS trim().toLowerCase(); reject matching active or blank Status; create a cleanup list for matching inactive/nonactive rows. Preserve complete stable-ID/physical-row/name/status/createdAt snapshot, validated by the reader.
3. One INSERT into the synthetic_m03_master_create_intents table fires a same-statement SQLite AFTER INSERT trigger. First assert **every** current catalog row exactly matches the complete observed snapshot; stale reads, concurrent duplicates and changed rows raise ABORT. Then DELETE only the preflight-matched inactive rows, assert exact deletion count, compact all remaining physical Sheet rows through a materialized row-number stage to avoid UNIQUE collisions, INSERT a synthetic immutable source ID receipt whose nested trigger increments the scoped PCAT/PUNT counter, INSERT exactly one new Active catalog row using that receipt's issued source ID, then stamp the immutable creation intent. Any failure aborts all effects.
4. Read back the exact committed intent and validate immutable hash/name/result. Lost response retry uses same operation ID. Counter must have been seeded to a reviewed high-water floor from the original source; missing/exhausted counters fail closed.

Snapshots are bound JSON values generated internally from every reviewed D1 row (including Unicode text and source indices), not user-defined SQL or SQLite NOCASE. SQL identifiers are fixed literal category/unit groups, one database represents one business. This is a **synthetic schema proof** until M02 importer/cutover reconciliation and M04 session/role authority are approved. It is not a deployable ERP feature.

## Acceptance

Test-first RED on missing implementation; GREEN Node SQLite and actual local Workerd/D1 tests: ordinary PCAT/PUNT creation, inactive duplicate purge with shifting, Unicode casefold, active duplicate, concurrent competing names, identical replay and changed hash collision, lost HTTP response, import ID floor, corrupted physical provenance, stale read, missing/exhausted counter, forced late-trigger failure rolls back catalog+receipt+counter, unrelated catalog remains unchanged. Test-only Worker uses immutable fixed actions, never client payload. Verify public RPC still 501 and existing 84 frozen files/36 HTML includes. Ten CI checks, no remote D1 migrations or live Worker changes.

## Later gates

Step 2: M04 products.add permission must be checked **in the exact D1 mutation boundary** (not a JS preflight followed by a blind write), with trusted actor, session expiry/revoke/role version. Current proof is internal and unavailable to staff/public. Step 3: audit remaining async edges. Step 4: review M02/M03/M04/shared kernel and CI evidence before changing the parallel readiness flag.