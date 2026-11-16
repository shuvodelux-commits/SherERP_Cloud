-- M02-13: Inert operational Products and immutable versioned unit catalog.
-- No source data, no live product writer, no stock/FIFO or public RPC activation.
-- Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2 keeps base
-- product Unit as text; ProductSettings.gs can delete a Unit master.
-- Optional unit model: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
CREATE TABLE products (
  product_id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(product_id)) > 0),
  source_profile TEXT NOT NULL CHECK (source_profile IN ('canonical','new')),
  source_snapshot_row_id INTEGER UNIQUE
    REFERENCES legacy_product_snapshots(row_id) ON DELETE RESTRICT,
  legacy_sheet_row INTEGER CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
  brand_text TEXT NOT NULL DEFAULT '',
  category_name TEXT NOT NULL DEFAULT '',
  base_unit_name TEXT NOT NULL CHECK (length(trim(base_unit_name)) > 0),
  -- Optional current master ID: historical unit name remains intact on deletion.
  base_unit_id TEXT REFERENCES product_units(unit_id) ON DELETE SET NULL,
  barcode_text TEXT NOT NULL DEFAULT '',
  purchase_price_text TEXT NOT NULL DEFAULT '',
  selling_price_text TEXT NOT NULL DEFAULT '',
  opening_stock_text TEXT NOT NULL DEFAULT '',
  minimum_stock_text TEXT NOT NULL DEFAULT '',
  product_type_text TEXT NOT NULL DEFAULT '',
  bundle_revision_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active','Inactive')),
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0,1)),
  current_unit_revision INTEGER NOT NULL DEFAULT 0
    CHECK (current_unit_revision >= 0),
  record_version INTEGER NOT NULL DEFAULT 0 CHECK (record_version >= 0),
  CHECK (
    (source_profile='canonical' AND source_snapshot_row_id IS NOT NULL
     AND legacy_sheet_row IS NOT NULL)
    OR (source_profile='new' AND source_snapshot_row_id IS NULL
     AND legacy_sheet_row IS NULL)
  )
) STRICT;
CREATE INDEX idx_products_name ON products(product_name COLLATE NOCASE);
CREATE INDEX idx_products_status ON products(status,is_deleted);

CREATE TABLE product_unit_profiles (
  product_id TEXT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision > 0),
  stock_unit_name TEXT NOT NULL CHECK (length(trim(stock_unit_name)) > 0),
  purchase_anchor_unit_name TEXT NOT NULL DEFAULT '',
  selling_anchor_unit_name TEXT NOT NULL DEFAULT '',
  stock_view_unit_name TEXT NOT NULL DEFAULT '',
  stock_purchase_override_text TEXT NOT NULL DEFAULT '',
  stock_selling_override_text TEXT NOT NULL DEFAULT '',
  created_at_text TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (product_id,revision)
) STRICT;

CREATE TABLE product_unit_conversions (
  product_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  conversion_id TEXT NOT NULL CHECK (length(trim(conversion_id)) > 0),
  unit_name TEXT NOT NULL CHECK (length(trim(unit_name)) > 0),
  -- Historical verified ID as immutable descriptive evidence, not a
  -- mutable foreign key: deleting a Unit master does not rewrite an invoice.
  reviewed_unit_master_id TEXT,
  factor_text TEXT NOT NULL
    CHECK (length(trim(factor_text)) > 0
      AND factor_text=trim(factor_text)
      AND factor_text GLOB '[0-9]*'
      AND factor_text NOT GLOB '*[^0-9.]*'
      AND length(factor_text)-length(replace(factor_text,'.','')) <= 1
      AND CAST(factor_text AS REAL) > 0),
  relation_qty_text TEXT NOT NULL DEFAULT '',
  relation_unit_name TEXT NOT NULL DEFAULT '',
  purchase_price_override_text TEXT NOT NULL DEFAULT '',
  selling_price_override_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Inactive')),
  source_conversion_row_id INTEGER
    REFERENCES legacy_product_unit_conversion_snapshots(row_id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id,revision,conversion_id),
  FOREIGN KEY (product_id,revision)
    REFERENCES product_unit_profiles(product_id,revision) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX idx_product_unit_revisions_name
  ON product_unit_conversions(product_id,revision,unit_name COLLATE NOCASE);
CREATE INDEX idx_product_unit_revision_lookup
  ON product_unit_conversions(product_id,revision,sort_order);

-- A canonical source record is not admitted based on a matching name,
-- barcode or same Product ID in another source repo.
CREATE TRIGGER trg_products_catalog_source_provenance
  BEFORE INSERT ON products WHEN NEW.source_profile='canonical'
  BEGIN
    SELECT RAISE(ABORT,'canonical product source provenance mismatch')
    WHERE NOT EXISTS (
      SELECT 1 FROM legacy_product_snapshots AS s
      WHERE s.row_id=NEW.source_snapshot_row_id
        AND s.source_profile='canonical'
        AND s.product_id=NEW.product_id
        AND s.legacy_sheet_row=NEW.legacy_sheet_row
        AND s.unit_text=NEW.base_unit_name
    );
  END;

-- Original Product ID, provenance and base-stock dimension are immutable;
-- changing the stock unit would reinterpret lots and historical postings.
CREATE TRIGGER trg_products_catalog_source_sealed
  BEFORE UPDATE ON products
  WHEN NEW.product_id <> OLD.product_id
    OR NEW.source_profile <> OLD.source_profile
    OR NEW.source_snapshot_row_id IS NOT OLD.source_snapshot_row_id
    OR NEW.legacy_sheet_row IS NOT OLD.legacy_sheet_row
    OR NEW.base_unit_name <> OLD.base_unit_name
  BEGIN SELECT RAISE(ABORT,'sealed product identity or stock unit'); END;

-- A new product always begins with legacy-compatible single base unit.
CREATE TRIGGER trg_products_catalog_first_revision
  BEFORE INSERT ON products WHEN NEW.current_unit_revision <> 0
  BEGIN SELECT RAISE(ABORT,'product must start at base-unit revision 0'); END;

-- A future authorized writer activates a revision only after its immutable
-- profile and matching original base-stock dimension already exist.
CREATE TRIGGER trg_products_catalog_revision_guard
  BEFORE UPDATE OF current_unit_revision ON products
  WHEN NEW.current_unit_revision <> OLD.current_unit_revision
   AND NEW.current_unit_revision <> 0
  BEGIN
    SELECT RAISE(ABORT,'missing or mismatched unit revision')
    WHERE NOT EXISTS (
      SELECT 1 FROM product_unit_profiles AS p
      WHERE p.product_id=NEW.product_id
        AND p.revision=NEW.current_unit_revision
        AND p.stock_unit_name=NEW.base_unit_name
    );
  END;

-- Referenced master ID is checked at configuration creation, then retained
-- as history even when ProductSettings permanently removes that master row.
CREATE TRIGGER trg_product_conversion_unit_review
  BEFORE INSERT ON product_unit_conversions
  WHEN NEW.reviewed_unit_master_id IS NOT NULL
  BEGIN
    SELECT RAISE(ABORT,'unverified active unit master')
    WHERE NOT EXISTS (
      SELECT 1 FROM product_units AS u
      WHERE u.unit_id=NEW.reviewed_unit_master_id
        AND u.status='Active'
        AND lower(u.unit_name)=lower(NEW.unit_name)
    );
  END;

CREATE TRIGGER trg_product_unit_profiles_immutable_update
  BEFORE UPDATE ON product_unit_profiles
  BEGIN SELECT RAISE(ABORT,'immutable unit profile revision'); END;
CREATE TRIGGER trg_product_unit_profiles_immutable_delete
  BEFORE DELETE ON product_unit_profiles
  BEGIN SELECT RAISE(ABORT,'immutable unit profile revision'); END;
CREATE TRIGGER trg_product_unit_conversions_immutable_update
  BEFORE UPDATE ON product_unit_conversions
  BEGIN SELECT RAISE(ABORT,'immutable unit conversion revision'); END;
CREATE TRIGGER trg_product_unit_conversions_immutable_delete
  BEFORE DELETE ON product_unit_conversions
  BEGIN SELECT RAISE(ABORT,'immutable unit conversion revision'); END;
