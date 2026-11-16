# M02 — Frozen product source-shape gate before D1 schema

**Source authority A:** shuvodelux-commits/Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 (Config.gs, 19 original PRODUCTS headers).
**Separate optional feature authority B:** shuvodelux-commits/sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c (24 extended PRODUCTS headers; 12 PRODUCT_UNIT_CONVERSIONS headers).
**Tracking:** M02 in docs/WORKSTREAMS.md; multi-unit dependency issue #314; do not alter live Sheets, source repos, public RPC or current financial/stock writers.

## 13-sentence overview

1. The next M02 prerequisite is to distinguish the pinned original Products source from the separately approved older multi-unit implementation.
2. The canonical Mohim_ERP PRODUCTS sheet has exactly 19 declared headers including Product Type and Bundle Revision.
3. The optional older sherERP_Mohim PRODUCTS sheet has 24 declared headers with seven unit-price and stock-view extensions instead of those two newer canonical fields.
4. That older source also defines a separate 12-header PRODUCT_UNIT_CONVERSIONS sheet.
5. Neither source profile may be quietly reinterpreted as the other during an import.
6. Original Product IDs, Conversion IDs, source-sheet row positions, empty cells, Unicode product names and barcode leading zeros must remain traceable.
7. Price, cost, factor and stock text must not be coerced through floating-point parsing in this preflight contract.
8. Different Product IDs remain distinct even if names, barcodes or display-unit labels match.
9. A supplementary conversion row cannot attach to a product unless that exact product's original ID was explicitly included in a reviewed source mapping.
10. This slice rejects malformed exports, extra columns, duplicate source IDs and unknown product references before any write.
11. It performs no catalog D1 migration, no active product mutation, no automatic historical unit conversion and no FIFO or POS posting.
12. A future numbered D1 migration and real local Workerd/D1 immutable source import will follow only after the pending M02 schema PR and related feature dependencies are merged and reviewed.
13. RED and GREEN GitHub tests cover a deterministic bounded, read-only source-shape preflight without granting remote migrations or live data cutover.

## Test-first acceptance

- RED: new Node contract tests import an intentionally absent pure module; preserve both exact source header sets and the independently pinned conversion header set.
- GREEN: implement a small pure export-plan validator, strictly bounded to 1000 text-preserving rows, producing original IDs, original fields and physical source rows.
- Verify duplicate/blank IDs, malformed row widths, nontext values, optional-profile opt-in, unknown conversion/product references, and preservation of raw decimal/leading-zero values.
- Keep this PR limited to the pure source contract, tests and its plan; **no schema migration while PR #402 is unmerged**.
- After all checks pass, review/merge separately. Next PR: numbered D1 PRODUCTS and conversions tables with real local D1 import/reconciliation, one schema owner, zero production data writes.

## Risk and release gates

This work supplies import preflight evidence only. It is not a live Products table, completed multi-unit feature, exact private-business reconciliation, or production readiness. Require the original-source review, approved supplementary dataset provenance, complete gross stock/account reconciliation, and owner-authorized backup/cutover before any real data transfer.
