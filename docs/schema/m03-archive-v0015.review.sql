-- M03 v0015 candidate archive design — REVIEW ONLY, NOT A LIVE D1 MIGRATION.
-- DO NOT place under migrations/, apply remotely, or bind to any public Worker.
-- Source pin: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
-- This models a private import-batch scoped snapshot for source parity review.
-- SQLite constraints cannot authenticate a server actor or attest real Sheets data.
-- Authentic M02/M10 independent evidence, explicit owner authorization, private
-- storage/encryption decisions, backup/restore and release review are outstanding.
-- The existing m03_private_source_* reader is not a tenant-aware reader for this design.
CREATE TABLE m03_archive_batches (
  tenant_id TEXT NOT NULL CHECK(length(tenant_id) BETWEEN 1 AND 64 AND tenant_id=trim(tenant_id)),
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 96 AND batch_id=trim(batch_id)),
  source_commit TEXT NOT NULL CHECK(source_commit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2'),
  source_manifest_digest TEXT NOT NULL CHECK(
    length(source_manifest_digest)=64
    AND source_manifest_digest NOT GLOB '*[^0-9a-f]*'
  ),
  evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 8 AND 256),
  status TEXT NOT NULL DEFAULT 'STAGING' CHECK(status IN ('STAGING','SEALED')),
  PRIMARY KEY(tenant_id,batch_id)
) STRICT;

CREATE TABLE m03_archive_groups (
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  source_group TEXT NOT NULL CHECK(source_group IN (
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
  headers_json TEXT NOT NULL CHECK(json_valid(headers_json)=1 AND json_type(headers_json)='array'),
  expected_rows INTEGER NOT NULL CHECK(expected_rows BETWEEN 0 AND 250000),
  source_digest TEXT NOT NULL CHECK(
    length(source_digest)=64
    AND source_digest NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL DEFAULT 'STAGING' CHECK(status IN ('STAGING','SEALED')),
  PRIMARY KEY(tenant_id,batch_id,source_group),
  FOREIGN KEY(tenant_id,batch_id) REFERENCES m03_archive_batches(tenant_id,batch_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE m03_archive_rows (
  tenant_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  source_group TEXT NOT NULL,
  legacy_sheet_row INTEGER NOT NULL CHECK(
    legacy_sheet_row BETWEEN 2 AND 9007199254740991
  ),
  cells_json TEXT NOT NULL CHECK(json_valid(cells_json)=1 AND json_type(cells_json)='array'),
  PRIMARY KEY(tenant_id,batch_id,source_group,legacy_sheet_row),
  FOREIGN KEY(tenant_id,batch_id,source_group)
    REFERENCES m03_archive_groups(tenant_id,batch_id,source_group)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

-- REPLACE must never erase an immutable source batch, including while STAGING.
CREATE TRIGGER trg_m03_archive_batch_insert_guard
BEFORE INSERT ON m03_archive_batches
WHEN NEW.status!='STAGING'
  OR EXISTS(SELECT 1 FROM m03_archive_batches b
       WHERE b.tenant_id=NEW.tenant_id AND b.batch_id=NEW.batch_id)
BEGIN
  SELECT RAISE(ABORT,'Private archive batch must be new STAGING');
END;

CREATE TRIGGER trg_m03_archive_group_insert_guard
BEFORE INSERT ON m03_archive_groups
WHEN NEW.status!='STAGING'
  OR EXISTS(SELECT 1 FROM m03_archive_groups g
       WHERE g.tenant_id=NEW.tenant_id AND g.batch_id=NEW.batch_id
         AND g.source_group=NEW.source_group)
  OR NOT EXISTS(SELECT 1 FROM m03_archive_batches b
       WHERE b.tenant_id=NEW.tenant_id AND b.batch_id=NEW.batch_id
         AND b.status='STAGING')
BEGIN
  SELECT RAISE(ABORT,'Private archive group must be new and in STAGING batch');
END;

CREATE TRIGGER trg_m03_archive_row_insert_guard
BEFORE INSERT ON m03_archive_rows
WHEN EXISTS(SELECT 1 FROM m03_archive_rows r
       WHERE r.tenant_id=NEW.tenant_id AND r.batch_id=NEW.batch_id
         AND r.source_group=NEW.source_group AND r.legacy_sheet_row=NEW.legacy_sheet_row)
  OR NOT EXISTS(SELECT 1 FROM m03_archive_groups g
       JOIN m03_archive_batches b
         ON b.tenant_id=g.tenant_id AND b.batch_id=g.batch_id
       WHERE g.tenant_id=NEW.tenant_id AND g.batch_id=NEW.batch_id
         AND g.source_group=NEW.source_group AND g.status='STAGING'
         AND b.status='STAGING')
BEGIN
  SELECT RAISE(ABORT,'Private archive source rows require a new STAGING group');
END;

-- A batch cannot self-certify completion until all 49 group seals exist.
-- A seal can change only status; trusted source evidence never mutates here.
CREATE TRIGGER trg_m03_archive_batch_update_guard
BEFORE UPDATE ON m03_archive_batches
WHEN NOT (
  OLD.status='STAGING' AND NEW.status='SEALED'
  AND NEW.tenant_id=OLD.tenant_id
  AND NEW.batch_id=OLD.batch_id
  AND NEW.source_commit=OLD.source_commit
  AND NEW.source_manifest_digest=OLD.source_manifest_digest
  AND NEW.evidence_ref=OLD.evidence_ref
  AND (SELECT COUNT(*) FROM m03_archive_groups g
       WHERE g.tenant_id=OLD.tenant_id AND g.batch_id=OLD.batch_id
         AND g.status='SEALED')=49
)
BEGIN
  SELECT RAISE(ABORT,'Private archive batch cannot be modified or partially sealed');
END;

CREATE TRIGGER trg_m03_archive_group_update_guard
BEFORE UPDATE ON m03_archive_groups
WHEN NOT (
  OLD.status='STAGING' AND NEW.status='SEALED'
  AND NEW.tenant_id=OLD.tenant_id AND NEW.batch_id=OLD.batch_id
  AND NEW.source_group=OLD.source_group
  AND NEW.headers_json=OLD.headers_json
  AND NEW.expected_rows=OLD.expected_rows
  AND NEW.source_digest=OLD.source_digest
  AND EXISTS(SELECT 1 FROM m03_archive_batches b
       WHERE b.tenant_id=OLD.tenant_id AND b.batch_id=OLD.batch_id
         AND b.status='STAGING')
  AND (SELECT COUNT(*) FROM m03_archive_rows r
       WHERE r.tenant_id=OLD.tenant_id AND r.batch_id=OLD.batch_id
         AND r.source_group=OLD.source_group)=OLD.expected_rows
)
BEGIN
  SELECT RAISE(ABORT,'Private archive group cannot be altered or incorrectly sealed');
END;

-- Staged row correction is explicit delete-then-insert under same physical
-- sheetRow, never an UPDATE that silently rewrites original row identity.
CREATE TRIGGER trg_m03_archive_row_update_forbidden
BEFORE UPDATE ON m03_archive_rows
BEGIN
  SELECT RAISE(ABORT,'Private archive source rows are immutable');
END;

CREATE TRIGGER trg_m03_archive_batch_delete_forbidden
BEFORE DELETE ON m03_archive_batches
BEGIN
  SELECT RAISE(ABORT,'Private archive batches cannot be deleted');
END;

CREATE TRIGGER trg_m03_archive_group_delete_forbidden
BEFORE DELETE ON m03_archive_groups
BEGIN
  SELECT RAISE(ABORT,'Private archive group seals cannot be deleted');
END;

CREATE TRIGGER trg_m03_archive_row_delete_guard
BEFORE DELETE ON m03_archive_rows
WHEN NOT EXISTS(SELECT 1 FROM m03_archive_groups g
       JOIN m03_archive_batches b ON b.tenant_id=g.tenant_id AND b.batch_id=g.batch_id
       WHERE g.tenant_id=OLD.tenant_id AND g.batch_id=OLD.batch_id
         AND g.source_group=OLD.source_group
         AND g.status='STAGING' AND b.status='STAGING')
BEGIN
  SELECT RAISE(ABORT,'Private archive source row cannot be deleted after seal');
END;
