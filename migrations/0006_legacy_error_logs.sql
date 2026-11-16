-- M02 frozen original LOGS only: Timestamp, Context, Message.
-- Original Utils.gs logError_ writes Date + context + message, with NO
-- stable Log ID. Repeated timestamps and entire duplicate entries are valid.
-- Internal row_id is not an exported/source business identity.
-- No foreign keys, financial journal, deletion or audit side effects.
CREATE TABLE legacy_error_logs (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  timestamp_text TEXT NOT NULL DEFAULT '',
  context TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT ''
) STRICT;

-- Nonunique, to preserve duplicate source error timestamps and messages.
CREATE INDEX idx_legacy_error_logs_timestamp
  ON legacy_error_logs(timestamp_text);
