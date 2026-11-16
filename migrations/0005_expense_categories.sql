-- M02 independent Expense Categories master only (EXPENSE_CATEGORIES).
-- Frozen Config.gs: Category ID, Category Name, Description, Status, Created At.
-- Source ExpenseSettings.gs updates names/descriptions/status, never hard-deletes
-- this master; existing duplicate historical display labels must not be merged.
-- No EXPENSES/EXPENSE_PAYEES, cash, accounts, Party, audit or posting tables.
CREATE TABLE expense_categories (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_sheet_row INTEGER UNIQUE
    CHECK (legacy_sheet_row IS NULL OR legacy_sheet_row >= 2),
  category_id TEXT NOT NULL UNIQUE CHECK (length(trim(category_id)) > 0),
  category_name TEXT NOT NULL CHECK (length(trim(category_name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active','Inactive','')),
  created_at TEXT NOT NULL DEFAULT ''
) STRICT;

-- Name lookup is an index, not historical uniqueness: only future
-- authenticated create/update adapters may enforce source-level casefolded
-- duplicate-name policy after original-ID and reconciliation gates.
CREATE INDEX idx_expense_categories_name
  ON expense_categories(category_name COLLATE NOCASE);
