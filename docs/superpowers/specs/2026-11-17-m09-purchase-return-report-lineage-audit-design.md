# M09 Purchase Return Report Lineage Audit — Design

**Lane:** M09. **Issue:** #431. **Coordination:** #456, `AGENTS.md`, `docs/PARALLEL_EXECUTION.md`. **Base main:** `1f068fc3c30c625446c560364fb872ae68cb8bc1`. **Source:** pinned `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` (`Utils.gs`, `DeleteEngine.gs`, `Reports.gs`, `PurchaseReturn.gs`, `Config.gs`).

## Why
Frozen `Utils.gs::activePurchaseReturnItems_` filters all `PURCHASE_RETURN_ITEMS` by active parent `PURCHASE_RETURN` **Return ID**, and filters deleted child rows with `isDeleted_`. Frozen `Reports.gs::getPurchaseReport` attributes the returned economic amount using **the child Purchase ID**, not the header's Purchase ID. Therefore a source-lineage mismatch can incorrectly shift returned value to another purchase if imported without review. Incomplete historical imports, orphan children, duplicate active IDs or deleted source purchases must never be mistaken for reconciled report data.

## Choice and contract
Implement a *new*, pure M09 `auditM09PurchaseReturnLineage({allPurchases,returnHeaders,returnItems})` module. Inputs are **complete original-source-shaped rows**, including historical soft deletions. Output is only `{ready:false,lineageComplete:boolean,status:'SOURCE_LINEAGE_ONLY'|'NEEDS_REVIEW',issues:string[]}`. Issues have fixed redacted codes: `INVALID_PURCHASE_ID`, `DUPLICATE_ACTIVE_PURCHASE_ID`, `INVALID_RETURN_ID`, `DUPLICATE_ACTIVE_RETURN_ID`, `MISSING_ACTIVE_PURCHASE`, `INVALID_CHILD_RETURN_ID`, `ORPHAN_ACTIVE_RETURN_ITEM`, `MISMATCHED_RETURN_PURCHASE`, `ACTIVE_RETURN_WITHOUT_ITEMS`. One code per class, no source IDs, amounts, names or rows, no auto-repair and no mutation.

Trusted preflight must reject missing/sparse arrays, malformed rows and accessors without invoking getters, and preserve `DeleteEngine.gs::isDeleted_` source behavior (mixed-case TRUE deleted, blank/false active). Active child rows with deleted parents are ignored just like frozen source, unless there is also an active parent with that Return ID. A perfect synthetic lineage result never authorizes a live report or provides an imported-source digest.

## Scope and alternatives
Selected: standalone internal-only preflight, no D1, no public RPC, no posting, no source modification, no UI/print change and no new dependencies. Integrating directly into the Purchase Report projector would mix source provenance with pure financial projection and require M03/M04 authority; deferred. Auto-fixing child Purchase IDs would mutate historical accounting and hide defects; prohibited.

**Ownership:** four M09-only paths (this spec; its plan; `tests/m09-purchase-return-report-lineage-audit.test.mjs`; `src/modules/m09-purchase-return-report-lineage-audit.js`). Parent PR #459 is merged into main. M02/M03/M04/M05/M07/M08 approval, M10 reconciliation, and M11 cutover remain prerequisites for any authenticated D1 reader/public report. Merge only after exact-head full CI and review.
