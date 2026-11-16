-- M02 0012: isolated, immutable, source-exact legacy PRODUCTS and optional older
-- PRODUCT_UNIT_CONVERSIONS snapshots. Not the active inventory/stock writer.
-- Original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
-- Older feature sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
-- Profiles have independent identities even when Product IDs match.
CREATE TABLE legacy_product_snapshots (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_profile TEXT NOT NULL CHECK (source_profile IN ('canonical','supplementary')),
  legacy_sheet_row INTEGER NOT NULL CHECK (legacy_sheet_row >= 2),
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  product_name TEXT NOT NULL DEFAULT '',
  brand_text TEXT NOT NULL DEFAULT '',
  category_text TEXT NOT NULL DEFAULT '',
  unit_text TEXT NOT NULL DEFAULT '',
  barcode_text TEXT NOT NULL DEFAULT '',
  purchase_price_text TEXT NOT NULL DEFAULT '',
  selling_price_text TEXT NOT NULL DEFAULT '',
  current_stock_text TEXT NOT NULL DEFAULT '',
  minimum_stock_text TEXT NOT NULL DEFAULT '',
  status_text TEXT NOT NULL DEFAULT '',
  created_at_text TEXT NOT NULL DEFAULT '',
  updated_at_text TEXT NOT NULL DEFAULT '',
  is_deleted_text TEXT NOT NULL DEFAULT '',
  deleted_by TEXT NOT NULL DEFAULT '',
  deleted_at_text TEXT NOT NULL DEFAULT '',
  delete_reason TEXT NOT NULL DEFAULT '',
  product_type_text TEXT NOT NULL DEFAULT '',
  bundle_revision_text TEXT NOT NULL DEFAULT '',
  purchase_price_unit_text TEXT NOT NULL DEFAULT '',
  selling_price_unit_text TEXT NOT NULL DEFAULT '',
  stock_unit_purchase_price_override_text TEXT NOT NULL DEFAULT '',
  stock_unit_selling_price_override_text TEXT NOT NULL DEFAULT '',
  stock_view_unit_text TEXT NOT NULL DEFAULT '',
  stock_entry_unit_text TEXT NOT NULL DEFAULT '',
  minimum_stock_unit_text TEXT NOT NULL DEFAULT '',
  UNIQUE (source_profile, legacy_sheet_row),
  UNIQUE (source_profile, product_id),
  CHECK (source_profile <> 'canonical' OR
    (purchase_price_unit_text = '' AND selling_price_unit_text = '' AND stock_unit_purchase_price_override_text = '' AND stock_unit_selling_price_override_text = '' AND stock_view_unit_text = '' AND stock_entry_unit_text = '' AND minimum_stock_unit_text = '')),
  CHECK (source_profile <> 'supplementary' OR
    (product_type_text = '' AND bundle_revision_text = ''))
) STRICT;

-- Preserve old conversion IDs; an older-source conversion MUST reference a
-- supplementary-source product, never a coincidentally matching canonical ID.
CREATE TABLE legacy_product_unit_conversion_snapshots (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_profile TEXT NOT NULL DEFAULT 'supplementary'
    CHECK (source_profile = 'supplementary'),
  legacy_sheet_row INTEGER NOT NULL CHECK (legacy_sheet_row >= 2),
  conversion_id TEXT NOT NULL CHECK (length(trim(conversion_id)) > 0),
  product_id TEXT NOT NULL CHECK (length(trim(product_id)) > 0),
  unit_name TEXT NOT NULL CHECK (length(trim(unit_name)) > 0),
  factor_text TEXT NOT NULL DEFAULT '',
  relation_qty_text TEXT NOT NULL DEFAULT '',
  relation_unit_name TEXT NOT NULL DEFAULT '',
  purchase_price_text TEXT NOT NULL DEFAULT '',
  selling_price_text TEXT NOT NULL DEFAULT '',
  sort_order_text TEXT NOT NULL DEFAULT '',
  status_text TEXT NOT NULL DEFAULT '',
  created_at_text TEXT NOT NULL DEFAULT '',
  updated_at_text TEXT NOT NULL DEFAULT '',
  UNIQUE (source_profile, legacy_sheet_row),
  UNIQUE (source_profile, conversion_id),
  FOREIGN KEY (source_profile,product_id)
    REFERENCES legacy_product_snapshots(source_profile,product_id)
    ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX idx_legacy_product_conversion_unit
 ON legacy_product_unit_conversion_snapshots(source_profile,product_id,unit_name COLLATE NOCASE);
CREATE INDEX idx_legacy_product_snapshots_source_name
 ON legacy_product_snapshots(source_profile,product_name);

CREATE TRIGGER trg_legacy_product_snapshots_no_update
 BEFORE UPDATE ON legacy_product_snapshots
 BEGIN SELECT RAISE(ABORT,'immutable product source snapshot'); END;
CREATE TRIGGER trg_legacy_product_snapshots_no_delete
 BEFORE DELETE ON legacy_product_snapshots
 BEGIN SELECT RAISE(ABORT,'immutable product source snapshot'); END;
CREATE TRIGGER trg_legacy_product_conversion_snapshots_no_update
 BEFORE UPDATE ON legacy_product_unit_conversion_snapshots
 BEGIN SELECT RAISE(ABORT,'immutable product conversion source snapshot'); END;
CREATE TRIGGER trg_legacy_product_conversion_snapshots_no_delete
 BEFORE DELETE ON legacy_product_unit_conversion_snapshots
 BEGIN SELECT RAISE(ABORT,'immutable product conversion source snapshot'); END;
