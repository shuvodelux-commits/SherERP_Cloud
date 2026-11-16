-- Frozen DELETE_LOG nine-column audit history. The original Log ID and
-- Deleted By Mobile are preserved as text, including leading phone zeros.
-- No invoice/Party/stock/bank FK: old references are not reinterpreted.
-- Imported audit history is immutable: source edits/deletions require a
-- separately reviewed, versioned correction procedure, not UPDATE/DELETE.
CREATE TABLE legacy_delete_log (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE
    CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  log_id TEXT NOT NULL UNIQUE CHECK (length(trim(log_id)) > 0),
  date_text TEXT NOT NULL DEFAULT '',
  time_text TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT '',
  record_id TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_by_mobile TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX idx_legacy_delete_log_record
  ON legacy_delete_log(module,record_id);

CREATE TRIGGER trg_legacy_delete_log_immutable_update
BEFORE UPDATE ON legacy_delete_log
BEGIN
  SELECT RAISE(ABORT,'immutable DELETE_LOG audit history');
END;

CREATE TRIGGER trg_legacy_delete_log_immutable_delete
BEFORE DELETE ON legacy_delete_log
BEGIN
  SELECT RAISE(ABORT,'immutable DELETE_LOG audit history');
END;
