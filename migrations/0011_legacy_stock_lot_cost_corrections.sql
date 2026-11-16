-- Frozen STOCK_LOT_COST_CORRECTIONS history only, original sixteen fields.
-- Do not recalculate purchase prices, COGS, historical invoice profit,
-- active stock lots or financial accounts from these historical rows.
-- No foreign keys to live M05/M06 inventory, sale or purchase tables.
CREATE TABLE legacy_stock_lot_cost_corrections (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER NOT NULL UNIQUE CHECK (legacy_sheet_row >= 2),
  correction_id TEXT NOT NULL UNIQUE CHECK (length(trim(correction_id)) > 0),
  date_text TEXT NOT NULL DEFAULT '',
  lot_id TEXT NOT NULL CHECK (length(trim(lot_id)) > 0),
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  product_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  old_purchase_price_text TEXT NOT NULL DEFAULT '',
  new_purchase_price_text TEXT NOT NULL DEFAULT '',
  original_quantity_text TEXT NOT NULL DEFAULT '',
  remaining_quantity_text TEXT NOT NULL DEFAULT '',
  matched_historical_quantity_text TEXT NOT NULL DEFAULT '',
  affected_invoice_count_text TEXT NOT NULL DEFAULT '',
  historical_cogs_delta_text TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  corrected_by TEXT NOT NULL DEFAULT '',
  created_at_text TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX idx_legacy_stock_lot_cost_corrections_lot
  ON legacy_stock_lot_cost_corrections(lot_id,date_text);
CREATE TRIGGER trg_legacy_stock_lot_cost_immutable_update
  BEFORE UPDATE ON legacy_stock_lot_cost_corrections
  BEGIN SELECT RAISE(ABORT,'immutable STOCK_LOT_COST_CORRECTIONS history'); END;
CREATE TRIGGER trg_legacy_stock_lot_cost_immutable_delete
  BEFORE DELETE ON legacy_stock_lot_cost_corrections
  BEGIN SELECT RAISE(ABORT,'immutable STOCK_LOT_COST_CORRECTIONS history'); END;
