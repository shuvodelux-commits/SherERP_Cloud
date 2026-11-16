# M10-08 — immutable INVOICE_EDIT_LOG source-to-local-D1 digest

**Source pin:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`. **Tracker:** #312. **Dependency:** merged M02 PR #367, `0009_legacy_invoice_edit_audit.sql`, `prepareSourceInvoiceEditAudit`, `importSourceInvoiceEditAuditWithD1`.

## Business reason and scope
The frozen original `INVOICE_EDIT_LOG` sheet has 12 exact headers: Log ID, Invoice ID, Edit Date, Reason, Before Grand Total, After Grand Total, Return ID, Before Return Amount, After Return Amount, Before Return Items JSON, After Return Items JSON, Edited By. Each row has a genuine original Log ID. Its amount columns are historical source **text**, not money posting instructions; source JSON snapshots and note whitespace are evidence, not normalized objects. The original invoice/return/staff references remain opaque and must never establish Party, finance or stock links.

## Approach
Introduce a small pure M10 function `summarizeM10InvoiceEditAudit({inventory,rows})` returning **exactly** `{sheetKey:'INVOICE_EDIT_LOG',rowCount,rowDigest,idDigest}`. Require frozen source inventory formatVersion=1 with exactly 49 unique well-formed group keys; `verifyInvoiceEditAuditMapping(inventory)` verifies 12 headers. Reuse M02 `prepareSourceInvoiceEditAudit(rows)` for canonical mapping, original source-row sequence, exact source IDs and known Date / finite safe Number conversion. Deliberately do not parse amount text or JSON. Domain-separated hashes:
- `SHA256(JSON.stringify(['M10-ROW-v1','INVOICE_EDIT_LOG',[[legacy_sheet_row,log_id,invoice_id,edit_date_text,reason,before_grand_total_text,after_grand_total_text,return_id,before_return_amount_text,after_return_amount_text,before_return_items_json,after_return_items_json,edited_by],...]]))`
- `SHA256(JSON.stringify(['M10-ID-v1','INVOICE_EDIT_LOG',[[legacy_sheet_row,log_id],...]]))`

Bytes are held only in memory; reject bad input with fixed `M10 INVOICE_EDIT_LOG evidence invalid`, never include private values, hashes or exceptions.

## Verification
1. Unit tests with independently computed domain-separated canonical digests; same invoice/return across multiple original Log IDs; source JSON formatting/Unicode/amount text/Date vs string; property-order invariance; immutable input; ID-only vs payload drift; valid shortened snapshot produces changed count/hash, not a false hard failure; malformed headers/duplicate IDs/unsafe getter and symbol rejection with redacted error.
2. Actual **isolated Workerd/D1** import of synthetic original source using existing reviewed M02 importer, followed by independent fixed SQL readback projected to source shape and SHA-256 parity. DB immutable UPDATE/DELETE triggers must reject tampering; alter only readback **copies** to demonstrate payload (e.g. `12.50` vs `12.5`, JSON whitespace) and original-ID drift. Replay blocked. Worker HTTP and RPC remain 404.
3. Use a **separate PR-only** `.github/workflows/m10-invoice-edit-audit-local-d1.yml` to avoid conflict with still-open independent M10-07 #374 editing shared `m10-catalog-digest-local-d1.yml`. No public DB binding or network source export.

## Alternatives rejected
Extending generic M10 catalog code before full 49-group review, or mutating immutable audit D1 triggers to create tamper evidence, or treating historical amounts as monetary balances. Each risks unintended data/ownership changes.

## Boundaries
No changes to M02 importer/mapping/schema, existing M10-01/03 release gates, open M10-07 #374, M07 #387/#390, original GAS/Sheets, finance/ledger/Party, public RPC, production DB or deployments. A synthetic parity proof is not permission to perform the real 49-group private import: `authorizesImport:false`, `productionReady:false` and full source freeze, restored backup, financial parity, security/performance gates remain blocking.
