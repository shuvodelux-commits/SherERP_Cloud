-- SherERP Cloud M02: reviewed low-risk master-data groups only.
-- This is NOT a migration of stock, payments, ledgers or transactional data.
-- Never derive row identity from implicit SQLite ordering or rowid recycling.
CREATE TABLE settings (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  key TEXT NOT NULL UNIQUE CHECK (length(trim(key)) > 0),
  value TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE product_categories (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  category_id TEXT NOT NULL UNIQUE CHECK (length(trim(category_id)) > 0),
  category_name TEXT NOT NULL CHECK (length(trim(category_name)) > 0),
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT
) STRICT;

CREATE TABLE product_units (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  unit_id TEXT NOT NULL UNIQUE CHECK (length(trim(unit_id)) > 0),
  unit_name TEXT NOT NULL CHECK (length(trim(unit_name)) > 0),
  status TEXT NOT NULL DEFAULT 'Active',
  created_at TEXT
) STRICT;

-- Labels are deliberately NOT unique and have NO FK to PRODUCTS.
-- ProductSettings.gs deletes inactive category/unit rows and allows the name
-- to be reused while PRODUCTS retains historical plain-text category/unit.
CREATE INDEX idx_product_categories_name ON product_categories(category_name COLLATE NOCASE);
CREATE INDEX idx_product_units_name ON product_units(unit_name COLLATE NOCASE);
