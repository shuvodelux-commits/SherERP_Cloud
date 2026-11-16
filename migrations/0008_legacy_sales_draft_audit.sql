-- M02 frozen SALES_DRAFT_AUDIT source, original eleven columns.
-- DraftSales.gs references historical Draft No to prevent reuse after
-- deletion/posting. Do not conflate the audit rows with live draft rows.
-- No FK to sales, staff or Party: historical source references stay opaque.
-- Source Version is held as original decimal TEXT, not cast to money.
CREATE TABLE legacy_sales_draft_audit (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE
    CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  audit_id TEXT NOT NULL UNIQUE CHECK (length(trim(audit_id)) > 0),
  timestamp_text TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL
    CHECK (action IN ('CREATED','UPDATED','DELETED','POSTED','POST_CLEANUP_RETRY')),
  draft_id TEXT NOT NULL CHECK (length(trim(draft_id)) > 0),
  draft_no TEXT NOT NULL CHECK (length(trim(draft_no)) > 0),
  version_text TEXT NOT NULL CHECK (length(trim(version_text)) > 0),
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  source_owner_id TEXT NOT NULL DEFAULT '',
  invoice_id TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE INDEX idx_legacy_sales_draft_audit_draft
  ON legacy_sales_draft_audit(draft_id,timestamp_text);
CREATE INDEX idx_legacy_sales_draft_audit_draft_no
  ON legacy_sales_draft_audit(draft_no);

CREATE TRIGGER trg_legacy_sales_draft_audit_immutable_update
BEFORE UPDATE ON legacy_sales_draft_audit
BEGIN SELECT RAISE(ABORT,'immutable SALES_DRAFT_AUDIT history'); END;

CREATE TRIGGER trg_legacy_sales_draft_audit_immutable_delete
BEFORE DELETE ON legacy_sales_draft_audit
BEGIN SELECT RAISE(ABORT,'immutable SALES_DRAFT_AUDIT history'); END;
