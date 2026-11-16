-- Source-only OPENING_BALANCE_EDIT_LOG archive; not a posting ledger.
CREATE TABLE legacy_opening_balance_edit_audit (
 row_id INTEGER PRIMARY KEY AUTOINCREMENT,
 legacy_sheet_row INTEGER NOT NULL UNIQUE CHECK (legacy_sheet_row >= 2),
 audit_id TEXT NOT NULL UNIQUE CHECK (length(trim(audit_id)) > 0),
 changed_at_text TEXT NOT NULL DEFAULT '',
 entity_type TEXT NOT NULL CHECK (length(trim(entity_type)) > 0),
 entity_id TEXT NOT NULL CHECK (length(trim(entity_id)) > 0),
 entity_name TEXT NOT NULL DEFAULT '',
 old_opening_balance_text TEXT NOT NULL DEFAULT '',
 new_opening_balance_text TEXT NOT NULL DEFAULT '',
 delta_text TEXT NOT NULL DEFAULT '',
 current_due_before_text TEXT NOT NULL DEFAULT '',
 current_due_after_text TEXT NOT NULL DEFAULT '',
 reason TEXT NOT NULL DEFAULT '',
 changed_by TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX idx_legacy_opening_balance_audit_entity ON legacy_opening_balance_edit_audit(entity_type,entity_id,changed_at_text);
CREATE TRIGGER trg_legacy_opening_balance_audit_immutable_update
 BEFORE UPDATE ON legacy_opening_balance_edit_audit
 BEGIN SELECT RAISE(ABORT,'immutable OPENING_BALANCE_EDIT_LOG audit history'); END;
CREATE TRIGGER trg_legacy_opening_balance_audit_immutable_delete
 BEFORE DELETE ON legacy_opening_balance_edit_audit
 BEGIN SELECT RAISE(ABORT,'immutable OPENING_BALANCE_EDIT_LOG audit history'); END;
