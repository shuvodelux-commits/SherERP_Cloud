-- M02-P1: party identity ONLY. No accounts, balances, journals or settlements.
-- Original sources: CUSTOMERS, SUPPLIERS, VENDORS, FINANCE_PERSONS, EXPENSE_PAYEES.
-- Do not use name/phone as a uniqueness constraint or infer a cross-role merge.
CREATE TABLE parties (
  party_id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(party_id))>0),
  display_name TEXT NOT NULL CHECK(length(trim(display_name))>0),
  party_kind TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(party_kind IN ('PERSON','BUSINESS','UNKNOWN')),
  phone TEXT,
  address TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT
) STRICT;

CREATE TABLE party_roles (
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('Customer','Supplier','Vendor','Owner','Lender','Borrower','Payee')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(party_id, role)
) STRICT;
CREATE INDEX idx_party_roles_role_active ON party_roles(role, status, party_id);

-- Deactivate roles rather than physically erase their historical membership.
CREATE TRIGGER trg_party_role_delete_forbidden
BEFORE DELETE ON party_roles
BEGIN
  SELECT RAISE(ABORT,'Historical Party roles cannot be deleted');
END;

-- Each original row has a stable provenance identity; a second linked source
-- record for the same Party is only possible through human verification.
CREATE TABLE party_legacy_links (
  link_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_group TEXT NOT NULL CHECK(source_group IN
    ('CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES')),
  source_id TEXT NOT NULL CHECK(length(trim(source_id))>0),
  legacy_sheet_row INTEGER CHECK(legacy_sheet_row IS NULL OR legacy_sheet_row>=2),
  party_id TEXT NOT NULL REFERENCES parties(party_id) ON DELETE RESTRICT,
  link_basis TEXT NOT NULL CHECK(link_basis IN ('ORIGINAL_RECORD','HUMAN_VERIFIED')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISPUTED','RETIRED')),
  created_at TEXT NOT NULL,
  UNIQUE(source_group, source_id),
  UNIQUE(source_group, legacy_sheet_row),
  CHECK (
    (link_basis='ORIGINAL_RECORD' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR
    (link_basis='HUMAN_VERIFIED' AND reviewed_by IS NOT NULL AND length(trim(reviewed_by))>0
      AND reviewed_at IS NOT NULL AND length(trim(reviewed_at))>0)
  )
) STRICT;
CREATE INDEX idx_party_legacy_links_party ON party_legacy_links(party_id, source_group);

CREATE TRIGGER trg_party_cross_source_verification
BEFORE INSERT ON party_legacy_links
WHEN EXISTS(SELECT 1 FROM party_legacy_links WHERE party_id=NEW.party_id)
  AND NEW.link_basis!='HUMAN_VERIFIED'
BEGIN
  SELECT RAISE(ABORT,'Cross-source Party link requires human verification');
END;

-- Never silently reassign a financial legacy record to another Party.
-- Future corrections require a dedicated auditable remapping procedure.
CREATE TRIGGER trg_party_legacy_identity_immutable
BEFORE UPDATE OF party_id, source_id, source_group ON party_legacy_links
BEGIN
  SELECT RAISE(ABORT,'Legacy Party identity is immutable');
END;
CREATE TRIGGER trg_party_legacy_link_delete_forbidden
BEFORE DELETE ON party_legacy_links
BEGIN
  SELECT RAISE(ABORT,'Historical legacy Party links cannot be deleted');
END;

CREATE TABLE party_identity_review (
  review_id TEXT PRIMARY KEY NOT NULL,
  source_group TEXT NOT NULL CHECK(source_group IN
    ('CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES')),
  source_id TEXT,
  candidate_party_id TEXT REFERENCES parties(party_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(reason IN
    ('MISSING_ID','DUPLICATE_ID','SHARED_PHONE','SAME_NAME','LEGACY_NAME_ALIAS','CONFLICT','OTHER')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CONFIRMED','REJECTED')),
  reviewer_id TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  CHECK (source_id IS NOT NULL OR reason='MISSING_ID'),
  CHECK ((status='OPEN' AND reviewer_id IS NULL AND reviewed_at IS NULL)
    OR (status IN ('CONFIRMED','REJECTED') AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL))
) STRICT;
CREATE INDEX idx_party_identity_review_open ON party_identity_review(status, source_group);

-- No automatic netting, journal, settlement, money, Cash Book or Cash Session
-- schemas are introduced in this migration.
