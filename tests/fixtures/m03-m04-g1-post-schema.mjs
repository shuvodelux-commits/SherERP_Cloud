/**
 * NONDEPLOYABLE M03 G1 overlay. These test tables extend the proposed M04
 * session schema and immutable operation_receipts fixture for local D1 only.
 * This is NOT a migrated sales, inventory, Cash Session or journal schema.
 */
export const M03_G1_POST_DDL=Object.freeze([
  `ALTER TABLE operation_receipts ADD COLUMN sku TEXT`,
  `ALTER TABLE operation_receipts ADD COLUMN units INTEGER`,
  `ALTER TABLE operation_receipts ADD COLUMN amount_cents INTEGER`,
  `CREATE TABLE synthetic_m03_g1_stock(
     business_id TEXT NOT NULL, sku TEXT NOT NULL,
     available INTEGER NOT NULL CHECK(available>=0),
     PRIMARY KEY(business_id,sku)
   ) STRICT`,
  `CREATE TABLE synthetic_m03_g1_journal(
     business_id TEXT NOT NULL, operation_id TEXT NOT NULL,
     account_kind TEXT NOT NULL CHECK(account_kind IN ('cash','sales_revenue')),
     signed_cents INTEGER NOT NULL CHECK(signed_cents<>0),
     PRIMARY KEY(business_id,operation_id,account_kind),
     FOREIGN KEY(business_id,operation_id)
       REFERENCES operation_receipts(tenant_id,operation_id)
   ) STRICT`,
  `CREATE TABLE synthetic_m03_g1_cash_sessions(
     business_id TEXT NOT NULL,
     session_id TEXT NOT NULL CHECK(length(trim(session_id))>0),
     status TEXT NOT NULL CHECK(status IN ('Starting','Open','Closing','Closed')),
     PRIMARY KEY(business_id,session_id)
   ) STRICT`,
  `CREATE UNIQUE INDEX synthetic_m03_g2_one_active_session
    ON synthetic_m03_g1_cash_sessions(business_id)
    WHERE status IN ('Starting','Open','Closing')`,
  // Even a direct test-only INSERT must obey the current session.
  `CREATE TRIGGER synthetic_m03_g2_cash_session_required
    BEFORE INSERT ON operation_receipts
    WHEN NOT EXISTS (
      SELECT 1 FROM synthetic_m03_g1_cash_sessions AS cs
      WHERE cs.business_id=NEW.tenant_id AND cs.status='Open'
    )
    BEGIN SELECT RAISE(ABORT,'G2 active Cash Session required'); END`,
  `CREATE TRIGGER synthetic_m03_g1_receipt_shape
    BEFORE INSERT ON operation_receipts
    WHEN NEW.operation_type<>'sales.post'
      OR NEW.sku IS NOT 'PIPE-1'
      OR NEW.units IS NULL OR NEW.units<1
      OR NEW.amount_cents IS NULL OR NEW.amount_cents<1
    BEGIN SELECT RAISE(ABORT,'G1 invalid synthetic receipt'); END`,
  `CREATE TRIGGER synthetic_m03_g1_post
    AFTER INSERT ON operation_receipts
    BEGIN
      UPDATE synthetic_m03_g1_stock
      SET available=available-NEW.units
      WHERE business_id=NEW.tenant_id AND sku=NEW.sku
        AND available>=NEW.units;
      SELECT CASE WHEN changes()=1 THEN 1
        ELSE RAISE(ABORT,'G1 stock CAS failed') END;
      INSERT INTO synthetic_m03_g1_journal
        (business_id,operation_id,account_kind,signed_cents)
      VALUES(NEW.tenant_id,NEW.operation_id,'cash',NEW.amount_cents);
      INSERT INTO synthetic_m03_g1_journal
        (business_id,operation_id,account_kind,signed_cents)
      VALUES(NEW.tenant_id,NEW.operation_id,'sales_revenue',-NEW.amount_cents);
    END`,
  `CREATE TRIGGER synthetic_m03_g1_journal_immutable_update
    BEFORE UPDATE ON synthetic_m03_g1_journal
    BEGIN SELECT RAISE(ABORT,'G1 journal immutable'); END`,
  `CREATE TRIGGER synthetic_m03_g1_journal_immutable_delete
    BEFORE DELETE ON synthetic_m03_g1_journal
    BEGIN SELECT RAISE(ABORT,'G1 journal immutable'); END`
]);
export const M03_G1_NOW=1_800_000_000_000;
export const M03_G1_TOKEN_ADMIN='a'.repeat(64);
export const M03_G1_TOKEN_CASHIER='b'.repeat(64);
export const M03_G1_TOKEN_DENY='c'.repeat(64);
export const M03_G1_TOKEN_SECOND='d'.repeat(64);
