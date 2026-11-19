# Pilot shop historical archive mapping review

Status: offline review candidate. This plan does not authorize an operational import. Keep the private archive, workbook parts, identifiers, hashes, and evidence reports in private custody. The source contract is the frozen `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` inventory.

## Review decisions

| Group | Frozen source behavior | Rehearsal disposition |
| --- | --- | --- |
| PRODUCTS | `Config.gs` defines the canonical product fields. The existing immutable product snapshot importer preserves Product IDs, physical order, and prices and quantities as text. | Rehearse a projection of the known columns in a disposable snapshot table and compare every projected field. Preserve extra columns by original position in the unchanged archive. Record blank normalization separately. Hold operational products and stock until each populated extra has an approved mapping or an approved archive-only disposition. Do not treat a snapshot's stock value as a posting. |
| PURCHASE_RETURN | `PurchaseReturn.gs` persists the actual refund method when creating a return. | For a verified source group with zero physical and populated rows, document zero rows for that capture. For a nonempty capture, obtain the source refund method or hold the group. Do not infer a cash or credit refund. |
| PURCHASE_RETURN_ITEMS | `PurchaseReturn.gs` writes the pricing basis for newly processed rows. | A verified zero-row capture needs no invented fields. For existing rows with a missing column, hold their pricing basis unless historical evidence establishes it. Current write defaults do not establish historical pricing. |
| INVOICE_EDIT_LOG | `SalesManagement.gs` and `PurchaseManagement.gs` append the common invoice edit fields. `SalesReturn.gs` appends return-specific fields and actor. | Match original invoice references against Sales and Purchases without printing IDs. Preserve the existing audit rows in the private archive until there is a reviewed partial audit projection or recovered evidence. The current strict D1 loader requires the full canonical header. Do not guess the actor or manufacture return IDs, amounts, or item snapshots. Do not replay an edit as a financial transaction. |
| BANK_TRANSFERS | `BankBook.gs` and `DeleteEngine.gs` depend on transfer identity and deletion state. | Verify both physical and populated row counts before recording an empty transfer group. For a nonempty capture, review deletion evidence and both related Bank Book legs. Do not infer active status or synthesize bank movements. An empty transfer group does not establish empty bank activity. |
| VENDOR_ISSUES | `Vendors.gs` uses `Memo ID \|\| Issue ID` for read display. Issue settlement and returns retain the original Issue ID. | Preserve the missing memo as absent. Use the existing display fallback only when rendering a reviewed read. Match vendor and product references on source IDs. Do not persist a generated Memo ID, group historical issues by date or name, or recreate stock or receivable postings. |

## Rehearsal checklist

The Owner approved keeping the populated `Conversion Unit` and `Conversion Factor` pair in the private archive. The first catalog projection excludes both fields from display and calculations. All 481 rows passed exact readback of the canonical projection in disposable Workerd D1. The stock audit found 41 negative lots across 33 products with unverified sale consumption links, so this catalog projection does not establish opening stock or valuation.

1. Run the existing archive row proof privately and retain the workbook and row parity checks. Derive the header plan by exact frozen column name. Keep the full plan private and record only aggregate outcomes.
2. Recheck zero rows from metadata and the actual read-only SQLite tables. Distinguish an empty sheet from a missing sheet or omitted capture. Hold unexpected changes.
3. For the product rehearsal, use the existing bounded canonical snapshot importer on a disposable Workerd/D1 binding. Confirm contiguous original positions and unique original Product IDs. Keep extra cells untouched in the source archive, count any null-to-empty projection, and compare the projected fields exactly on readback. Confirm replay is refused and active catalog tables remain empty.
4. Count invoice, vendor, and product references. Treat unmatched or ambiguous references as review items. Retain source IDs and separately reconcile any future operational mapper against the exact snapshot. Require finance review for account and balance parity.
5. Before any remote operation, confirm the actual pilot database UUID, per-group approved dispositions, backup restoration, independently reviewed source-to-target reconciliation and release approval. Dashboard metrics stay unavailable until their individual source groups and read models pass these checks.

The operational migrations currently cover only part of the ERP schema. Archive integrity and a product snapshot rehearsal do not establish that the full ERP dashboard or historical finance import is ready.
