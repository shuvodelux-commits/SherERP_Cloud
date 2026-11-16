# M10-09 — reviewed six-group original-ID versus positional-source parity

**Frozen legacy source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracker:** #312.

## Problem
M10-01 compares externally supplied 49-group source and D1 summaries in the `{sheetKey,rowCount,rowDigest,idDigest}` format. But the genuine original `LOGS` sheet contains **no original Log ID**: M10-05 intentionally returns `{sheetKey,rowCount,rowDigest,positionDigest,identityKind:'SOURCE_ROW_POSITION_ONLY'}`, never `idDigest`. Pretending its physical-row position is a source identity silently exaggerates migration reconciliation and could make gate reporting misleading.

## Boundaries and dependencies
Only **six** M10 groups already merged to `main`: PRODUCT_CATEGORIES, PRODUCT_UNITS, EXPENSE_CATEGORIES, DELETE_LOG, SALES_DRAFT_AUDIT (five true original-ID groups), and LOGS (one positional-provenance group). M10-08 `INVOICE_EDIT_LOG` remains open in #391 and is intentionally excluded. Source columns must pass existing M02 frozen mapping checks (`verifyCatalogMapping`, `verifyExpenseCategoryMapping`, `verifyDeleteLogMapping`, `verifySalesDraftAuditMapping`, `verifyLegacyErrorLogMapping`). Existing digest implementations/Workerd tests are not modified.

## Design
Add small pure `assessM10ReviewedGroupParity({inventory,sourceSummaries,d1Summaries})`. Accept only the six reviewed, syntactically validated, externally supplied digest objects; never read Sheets, Worker or D1. Original-ID group objects must have **exactly** `{sheetKey,rowCount,rowDigest,idDigest}`; LOGS must have **exactly** `{sheetKey,rowCount,rowDigest,positionDigest,identityKind:'SOURCE_ROW_POSITION_ONLY'}` and **must not** have `idDigest`. Every hash is lower-case 64-character hex. No group may be duplicated or replaced by an unreviewed group. If an expected group is missing, or source/D1 count, row, original-ID or positional digests differ, emit only fixed diagnostic codes and counts, not source IDs, hash bytes or detailed row contents.

Return only `{formatVersion:1,phase:'M10_REVIEWED_GROUP_PARITY',reviewedGroups:6,originalIdGroups:5,positionOnlyGroups:1,comparisonsComplete,groupsMatched,authorizesImport:false,productionReady:false,issues:[{code,count}]}`. `comparisonsComplete` means **only** all six reviewed groups are represented; it must never mean all 49 source groups are complete. `groupsMatched` means all six supplied source/D1 summaries compare identically, **not** independent source capture proof.

Incomplete arrays or omitted inputs should yield redacted missing-group issues. Invalid object shapes, getters, symbols, prototype pollution, malformed hashes, inventory drift or an ID-less `LOGS` object masquerading as `idDigest` throw only `M10 reviewed group parity evidence invalid`. Never log individual group names/amounts/identifiers in errors.

## Verification
- Unit tests independent of implementation ensure that five authentic-ID groups and one positional group can compare, while `LOGS` spoofed with `idDigest` always fails closed.
- Test rowCount, rowDigest, idDigest and positionDigest drift independently; source/D1 missing, duplicate, swapped/unreviewed groups, incorrect frozen headers, invalid shape/getter/symbol and input immutability.
- Prove even perfectly matching six-group summaries return `authorizesImport:false`, `productionReady:false`, and cannot be passed as a 49-group source freeze to `assessM10RehearsalEvidence`.
- Foundation suite covers these unit checks. Existing PR-only M10 real Workerd/D1 suite already independently exercises each merged group’s mapping and persisted-D1 readback. This new comparator itself is **pure**, and no new real D1 integration is claimed.

## Alternatives
1. **Chosen:** narrowly typed six-group provenance-aware parity comparison. Small, auditable, separate from M10-01.
2. **Rejected:** supply LOGS `idDigest=positionDigest` to M10-01 — impersonates missing original identity.
3. **Rejected:** expand M10-01 to mixed source group taxonomy before all 49 groups are reviewed; would weaken or overstate 49-group migration readiness.

## Release constraints
No live data, no owner identity review bypass, no account netting, no M02/DB/schema changes, no GAS/source edits, no worker routes, no public preview D1, no production D1 or deployment; no cutover claim. Owner-reviewed PR revert is rollback.
