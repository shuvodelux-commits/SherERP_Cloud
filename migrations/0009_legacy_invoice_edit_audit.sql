-- M02 frozen historical INVOICE_EDIT_LOG only, twelve source columns.
-- SalesReturn.gs appends return-edit evidence, leaving unrelated optional
-- grand-total fields blank. All numeric source values are retained as
-- descriptive TEXT, never recalculated or posted as financial amounts.
-- Original JSON snapshots, note whitespace, log ID and source-row location
-- must not be normalized, deduplicated by invoice or rewritten.
-- No FK to live invoice, user, return, Party or accounting tables.
CREATE TABLE legacy_invoice_edit_audit (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE
    CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  log_id TEXT NOT NULL UNIQUE CHECK (length(trim(log_id)) > 0),
  invoice_id TEXT NOT NULL DEFAULT '',
  edit_date_text TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  before_grand_total_text TEXT NOT NULL DEFAULT '',
  after_grand_total_text TEXT NOT NULL DEFAULT '',
  return_id TEXT NOT NULL DEFAULT '',
  before_return_amount_text TEXT NOT NULL DEFAULT '',
  after_return_amount_text TEXT NOT NULL DEFAULT '',
  before_return_items_json TEXT NOT NULL DEFAULT '',
  after_return_items_json TEXT NOT NULL DEFAULT '',
  edited_by TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX idx_legacy_invoice_edit_audit_invoice
  ON legacy_invoice_edit_audit(invoice_id,edit_date_text);
CREATE INDEX idx_legacy_invoice_edit_audit_return
  ON legacy_invoice_edit_audit(return_id);

CREATE TRIGGER trg_legacy_invoice_edit_audit_immutable_update
BEFORE UPDATE ON legacy_invoice_edit_audit
BEGIN SELECT RAISE(ABORT,'immutable INVOICE_EDIT_LOG audit history'); END;

CREATE TRIGGER trg_legacy_invoice_edit_audit_immutable_delete
BEFORE DELETE ON legacy_invoice_edit_audit
BEGIN SELECT RAISE(ABORT,'immutable INVOICE_EDIT_LOG audit history'); END;
