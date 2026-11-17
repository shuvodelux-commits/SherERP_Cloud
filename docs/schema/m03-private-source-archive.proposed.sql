-- M03 ISOLATED TEST/REVIEW PROPOSAL ONLY — NOT A NUMBERED PRODUCTION MIGRATION.
-- Original immutable GAS/Sheets: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
-- This private archive stores *source-shaped synthetic data*, not financial postings.
-- No Cloudflare Worker binding, public RPC, staff token or real-data import here.
-- sqlite foreign key constraints also require PRAGMA foreign_keys=ON in test clients.
-- The source_digest is independently checked by createFrozenSourceReadback().
-- SQLite only proves row count and post-seal write protection; it CANNOT
-- establish that original-source data/digest are genuine.
CREATE TABLE m03_private_source_seals (
  source_commit TEXT NOT NULL
    CHECK(source_commit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2'),
  source_group TEXT NOT NULL
    CHECK(source_group IN (
    'PRODUCTS',
    'BUNDLE_COMPONENTS',
    'SALE_BUNDLE_COMPONENTS',
    'SUPPLIERS',
    'SUPPLIER_LEDGER',
    'STOCK_LOTS',
    'SALE_ITEM_LOTS',
    'STOCK_LOT_COST_CORRECTIONS',
    'PURCHASES',
    'PURCHASE_ITEMS',
    'SALES',
    'SALE_PAYMENTS',
    'SALE_POSTING_JOURNAL',
    'SALES_DRAFTS',
    'SALES_DRAFT_AUDIT',
    'SALE_ITEMS',
    'CUSTOMERS',
    'CUSTOMER_LEDGER',
    'EXPENSES',
    'EXPENSE_CATEGORIES',
    'EXPENSE_PAYEES',
    'CASH_BOOK',
    'STOCK_MOVEMENT',
    'SETTINGS',
    'SALES_RETURN',
    'SALES_RETURN_ITEMS',
    'PURCHASE_RETURN',
    'PURCHASE_RETURN_ITEMS',
    'CASH_SESSIONS',
    'INVOICE_EDIT_LOG',
    'USERS',
    'ROLES',
    'SESSIONS',
    'LOGS',
    'DELETE_LOG',
    'OPENING_BALANCE_EDIT_LOG',
    'BANK_ACCOUNTS',
    'BANK_BOOK',
    'BANK_TRANSFERS',
    'FINANCE_TRANSACTIONS',
    'FINANCE_PERSONS',
    'PRODUCT_CATEGORIES',
    'PRODUCT_UNITS',
    'VENDORS',
    'VENDOR_SOURCING',
    'VENDOR_LEDGER',
    'VENDOR_RETURNS',
    'VENDOR_ISSUES',
    'VENDOR_RETURNS_RECEIVED'
    )),
  headers_json TEXT NOT NULL CHECK(json_valid(headers_json)=1),
  expected_rows INTEGER NOT NULL
    CHECK(expected_rows BETWEEN 0 AND 250000),
  source_digest TEXT NOT NULL
    CHECK(length(source_digest)=64
      AND source_digest NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL DEFAULT 'STAGING'
    CHECK(status IN ('STAGING','SEALED')),
  PRIMARY KEY (source_commit,source_group)
) STRICT;

CREATE TABLE m03_private_source_rows (
  source_commit TEXT NOT NULL
    CHECK(source_commit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2'),
  source_group TEXT NOT NULL,
  legacy_sheet_row INTEGER NOT NULL
    CHECK(legacy_sheet_row BETWEEN 2 AND 9007199254740991),
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json)=1),
  PRIMARY KEY(source_commit,source_group,legacy_sheet_row),
  FOREIGN KEY(source_commit,source_group)
    REFERENCES m03_private_source_seals(source_commit,source_group)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

-- Require a fresh staging record. A fabricated 'SEALED' insert is forbidden.
CREATE TRIGGER trg_m03_private_seal_insert_staging
BEFORE INSERT ON m03_private_source_seals
WHEN NEW.status!='STAGING'
BEGIN SELECT RAISE(ABORT,'Private source seal must enter STAGING'); END;

-- A sealed group is immutable: its digest, headers, count and status never
-- change after sealing. Never treat post-seal updates as source corrections.
CREATE TRIGGER trg_m03_private_seal_final_immutable
BEFORE UPDATE ON m03_private_source_seals
WHEN OLD.status='SEALED'
BEGIN SELECT RAISE(ABORT,'Private source seal immutable'); END;

-- Original source group/commit are identities, not reassignable labels.
CREATE TRIGGER trg_m03_private_seal_provenance_immutable
BEFORE UPDATE ON m03_private_source_seals
WHEN OLD.source_commit!=NEW.source_commit OR OLD.source_group!=NEW.source_group
BEGIN SELECT RAISE(ABORT,'Private source provenance immutable'); END;

-- Seal only the exact predeclared row count. Reject edits to other seal
-- evidence in the transition statement; stage such evidence separately.
-- SQLite serializes this UPDATE and its count in the same write transaction.
CREATE TRIGGER trg_m03_private_seal_validate_count
BEFORE UPDATE ON m03_private_source_seals
WHEN OLD.status='STAGING' AND NEW.status='SEALED'
  AND (NEW.headers_json!=OLD.headers_json
    OR NEW.expected_rows!=OLD.expected_rows
    OR NEW.source_digest!=OLD.source_digest
    OR (SELECT COUNT(*) FROM m03_private_source_rows r
        WHERE r.source_commit=OLD.source_commit
          AND r.source_group=OLD.source_group) != OLD.expected_rows)
BEGIN SELECT RAISE(ABORT,'Private source seal count or evidence mismatch'); END;

-- Existing source-seal records are historical evidence, never deleted.
CREATE TRIGGER trg_m03_private_seal_no_delete
BEFORE DELETE ON m03_private_source_seals
BEGIN SELECT RAISE(ABORT,'Private source seal delete forbidden'); END;

-- No source row may be inserted except under a matching STAGING seal.
-- This is an explicit guard even if a client disables SQLite foreign_keys.
CREATE TRIGGER trg_m03_private_row_requires_staging
BEFORE INSERT ON m03_private_source_rows
WHEN NOT EXISTS (
  SELECT 1 FROM m03_private_source_seals s
  WHERE s.source_commit=NEW.source_commit
    AND s.source_group=NEW.source_group
    AND s.status='STAGING'
)
BEGIN SELECT RAISE(ABORT,'Private source rows require STAGING'); END;

-- Append-only source rows: correction before seal requires STAGING delete
-- followed by INSERT under the original physical source row identity.
CREATE TRIGGER trg_m03_private_row_no_update
BEFORE UPDATE ON m03_private_source_rows
BEGIN SELECT RAISE(ABORT,'Private source row update forbidden'); END;

-- Allow source-row removal for STAGING rollback/reset only, never SEALED.
CREATE TRIGGER trg_m03_private_row_delete_staging_only
BEFORE DELETE ON m03_private_source_rows
WHEN NOT EXISTS (
  SELECT 1 FROM m03_private_source_seals s
  WHERE s.source_commit=OLD.source_commit
    AND s.source_group=OLD.source_group
    AND s.status='STAGING'
)
BEGIN SELECT RAISE(ABORT,'Private source row immutable after seal'); END;
