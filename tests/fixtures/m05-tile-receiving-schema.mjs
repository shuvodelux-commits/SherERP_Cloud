/**
 * LOCAL TEST FIXTURE ONLY — not a numbered migration, deployable inventory
 * writer, staff authorization design or general financial account model.
 * One isolated synthetic business per ephemeral Workerd/D1 database.
 */
export const M05_TILE_RECEIVE_DDL=[
`CREATE TABLE m05_tile_test_sessions(
 shop_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('Open','Closed'))
) STRICT`,
`CREATE TABLE m05_tile_test_suppliers(
 supplier_id TEXT PRIMARY KEY,party_id TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)),
 payable_paisa INTEGER NOT NULL CHECK(payable_paisa>=0)
) STRICT`,
`CREATE TABLE m05_tile_test_supplier_links(
 supplier_id TEXT PRIMARY KEY,party_id TEXT NOT NULL,reviewed INTEGER NOT NULL CHECK(reviewed IN (0,1))
) STRICT`,
`CREATE TABLE m05_tile_test_customer_ar(
 party_id TEXT PRIMARY KEY,receivable_paisa INTEGER NOT NULL CHECK(receivable_paisa>=0)
) STRICT`,
`CREATE TABLE m05_tile_test_stock(
 product_id TEXT PRIMARY KEY,pcs INTEGER NOT NULL CHECK(pcs>=0),
 version INTEGER NOT NULL CHECK(version>=1)
) STRICT`,
`CREATE TABLE m05_tile_test_receipts(
 operation_id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL UNIQUE,
 actor_id TEXT NOT NULL,intent_hash TEXT NOT NULL CHECK(length(intent_hash)=64),
 supplier_id TEXT NOT NULL,product_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 expected_stock_version INTEGER NOT NULL CHECK(expected_stock_version>0),
 expected_catalog_version INTEGER NOT NULL CHECK(expected_catalog_version>=0),
 received_pcs INTEGER NOT NULL CHECK(received_pcs>0 AND received_pcs<=1000000),
 boxes INTEGER NOT NULL CHECK(boxes>=0 AND boxes<=1000000),
 extra_pieces INTEGER NOT NULL CHECK(extra_pieces>=0 AND extra_pieces<=1000000),
 pricing_unit TEXT NOT NULL CHECK(pricing_unit IN ('Box','Pcs','Sqft')),
 unit_price_text TEXT NOT NULL,
 line_amount_paisa INTEGER NOT NULL CHECK(line_amount_paisa>=0 AND line_amount_paisa<=1000000000),
 request_snapshot_json TEXT NOT NULL CHECK(json_valid(request_snapshot_json)),
 measurement_snapshot_json TEXT NOT NULL CHECK(json_valid(measurement_snapshot_json)),
 price_snapshot_json TEXT NOT NULL CHECK(json_valid(price_snapshot_json)),
 purchase_date TEXT NOT NULL CHECK(length(purchase_date)=10),
 entry_kind TEXT NOT NULL DEFAULT 'UnpaidCredit' CHECK(entry_kind='UnpaidCredit')
) STRICT`,
`CREATE TABLE m05_tile_test_lots(
 lot_id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL UNIQUE,product_id TEXT NOT NULL,
 supplier_id TEXT NOT NULL,revision INTEGER NOT NULL,
 received_pcs INTEGER NOT NULL CHECK(received_pcs>0),
 line_amount_paisa INTEGER NOT NULL CHECK(line_amount_paisa>=0),
 purchase_date TEXT NOT NULL,
 request_snapshot_json TEXT NOT NULL,measurement_snapshot_json TEXT NOT NULL,
 price_snapshot_json TEXT NOT NULL
) STRICT`,
`CREATE TABLE m05_tile_test_movements(
 purchase_id TEXT PRIMARY KEY,lot_id TEXT NOT NULL,product_id TEXT NOT NULL,
 units_in INTEGER NOT NULL CHECK(units_in>0),
 stock_after INTEGER NOT NULL CHECK(stock_after>=0)
) STRICT`,
`CREATE TABLE m05_tile_test_supplier_ledger(
 purchase_id TEXT PRIMARY KEY,supplier_id TEXT NOT NULL,
 debit_paisa INTEGER NOT NULL CHECK(debit_paisa>=0),
 balance_paisa INTEGER NOT NULL CHECK(balance_paisa>=0)
) STRICT`,
`CREATE TRIGGER m05_tile_test_receive_guard AFTER INSERT ON m05_tile_test_receipts
BEGIN
 SELECT RAISE(ABORT,'m05-tile-unverified-catalog-price-or-quantity')
 WHERE NOT EXISTS(
  SELECT 1 FROM products p
  JOIN product_unit_profiles u
   ON u.product_id=p.product_id AND u.revision=NEW.revision
  JOIN product_tile_measurement_revisions m
   ON m.product_id=u.product_id AND m.revision=u.revision
  JOIN product_unit_conversions c
   ON c.product_id=m.product_id AND c.revision=m.revision
   AND c.conversion_id=m.box_conversion_id
  WHERE p.product_id=NEW.product_id
   AND p.base_unit_name='Pcs' AND u.stock_unit_name='Pcs'
   AND p.status='Active' AND p.is_deleted=0 AND p.product_type_text<>'Bundle'
   AND p.current_unit_revision=NEW.revision
   AND p.record_version=NEW.expected_catalog_version
   AND c.status='Active'
   AND m.pieces_per_box<=1000000
   AND NEW.received_pcs=NEW.boxes*m.pieces_per_box+NEW.extra_pieces
   AND NEW.pricing_unit=m.purchase_pricing_unit
   AND json_extract(NEW.request_snapshot_json,'$.mode')='pack'
   AND json_extract(NEW.request_snapshot_json,'$.boxes')=CAST(NEW.boxes AS TEXT)
   AND json_extract(NEW.request_snapshot_json,'$.extraPieces')=CAST(NEW.extra_pieces AS TEXT)
   AND json_extract(NEW.measurement_snapshot_json,'$.productId')=NEW.product_id
   AND json_extract(NEW.measurement_snapshot_json,'$.revision')=CAST(NEW.revision AS TEXT)
   AND json_extract(NEW.measurement_snapshot_json,'$.piecesPerBox')=CAST(m.pieces_per_box AS TEXT)
   AND json_extract(NEW.measurement_snapshot_json,'$.coveragePolicy')=m.coverage_policy
   AND json_extract(NEW.price_snapshot_json,'$.pricingUnit')=NEW.pricing_unit
   AND json_extract(NEW.price_snapshot_json,'$.unitPriceText')=NEW.unit_price_text
   AND (
    (NEW.pricing_unit='Sqft'
      AND m.purchase_sqft_price_override_text=NEW.unit_price_text)
    OR
    (NEW.pricing_unit='Box' AND (
      (lower(u.purchase_anchor_unit_name)=lower(c.unit_name)
       AND p.purchase_price_text=NEW.unit_price_text
       AND (c.purchase_price_override_text='' OR (CASE WHEN instr(c.purchase_price_override_text,'.')>0 THEN rtrim(rtrim(c.purchase_price_override_text,'0'),'.') ELSE c.purchase_price_override_text END)=(CASE WHEN instr(NEW.unit_price_text,'.')>0 THEN rtrim(rtrim(NEW.unit_price_text,'0'),'.') ELSE NEW.unit_price_text END)))
      OR
      (lower(u.purchase_anchor_unit_name)<>lower(c.unit_name)
       AND c.purchase_price_override_text=NEW.unit_price_text)
    ))
    OR
    (NEW.pricing_unit='Pcs' AND (
      ((u.purchase_anchor_unit_name='' OR lower(u.purchase_anchor_unit_name)='pcs')
       AND p.purchase_price_text=NEW.unit_price_text
       AND (u.stock_purchase_override_text='' OR (CASE WHEN instr(u.stock_purchase_override_text,'.')>0 THEN rtrim(rtrim(u.stock_purchase_override_text,'0'),'.') ELSE u.stock_purchase_override_text END)=(CASE WHEN instr(NEW.unit_price_text,'.')>0 THEN rtrim(rtrim(NEW.unit_price_text,'0'),'.') ELSE NEW.unit_price_text END)))
      OR
      (u.purchase_anchor_unit_name<>'' AND lower(u.purchase_anchor_unit_name)<>'pcs'
       AND u.stock_purchase_override_text=NEW.unit_price_text)
    ))
   )
 );
 SELECT RAISE(ABORT,'m05-tile-supplier-party-or-session-invalid')
 WHERE NOT EXISTS(
  SELECT 1 FROM m05_tile_test_sessions s
  WHERE s.shop_id='TEST-SHOP' AND s.state='Open'
 ) OR NOT EXISTS(
  SELECT 1 FROM m05_tile_test_suppliers s
  JOIN m05_tile_test_supplier_links l ON l.supplier_id=s.supplier_id
   AND l.party_id=s.party_id AND l.reviewed=1
  WHERE s.supplier_id=NEW.supplier_id AND s.active=1
 );

 UPDATE m05_tile_test_stock SET pcs=pcs+NEW.received_pcs,version=version+1
 WHERE product_id=NEW.product_id AND version=NEW.expected_stock_version;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05-tile-stock-version-stale') END;

 INSERT INTO m05_tile_test_lots
  (lot_id,purchase_id,product_id,supplier_id,revision,received_pcs,line_amount_paisa,
   purchase_date,request_snapshot_json,measurement_snapshot_json,price_snapshot_json)
 VALUES('LOT-'||NEW.purchase_id,NEW.purchase_id,NEW.product_id,NEW.supplier_id,
  NEW.revision,NEW.received_pcs,NEW.line_amount_paisa,NEW.purchase_date,
  NEW.request_snapshot_json,NEW.measurement_snapshot_json,NEW.price_snapshot_json);

 INSERT INTO m05_tile_test_movements(purchase_id,lot_id,product_id,units_in,stock_after)
 SELECT NEW.purchase_id,'LOT-'||NEW.purchase_id,NEW.product_id,NEW.received_pcs,stock.pcs
 FROM m05_tile_test_stock stock WHERE stock.product_id=NEW.product_id;

 UPDATE m05_tile_test_suppliers SET payable_paisa=payable_paisa+NEW.line_amount_paisa
 WHERE supplier_id=NEW.supplier_id AND active=1
 AND EXISTS(SELECT 1 FROM m05_tile_test_supplier_links l
  WHERE l.supplier_id=m05_tile_test_suppliers.supplier_id
  AND l.party_id=m05_tile_test_suppliers.party_id AND l.reviewed=1);
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'m05-tile-supplier-stale') END;

 INSERT INTO m05_tile_test_supplier_ledger(purchase_id,supplier_id,debit_paisa,balance_paisa)
 SELECT NEW.purchase_id,NEW.supplier_id,NEW.line_amount_paisa,s.payable_paisa
 FROM m05_tile_test_suppliers s WHERE s.supplier_id=NEW.supplier_id;
END`,
`CREATE TRIGGER m05_tile_test_receipt_immutable_update BEFORE UPDATE ON m05_tile_test_receipts
BEGIN SELECT RAISE(ABORT,'immutable tile receipt'); END`,
`CREATE TRIGGER m05_tile_test_receipt_immutable_delete BEFORE DELETE ON m05_tile_test_receipts
BEGIN SELECT RAISE(ABORT,'immutable tile receipt'); END`,
`CREATE TRIGGER m05_tile_test_lot_immutable_update BEFORE UPDATE ON m05_tile_test_lots
BEGIN SELECT RAISE(ABORT,'immutable tile lot'); END`,
`CREATE TRIGGER m05_tile_test_lot_immutable_delete BEFORE DELETE ON m05_tile_test_lots
BEGIN SELECT RAISE(ABORT,'immutable tile lot'); END`
];

export const M05_TILE_RECEIVE_INSERT_SQL=
 'INSERT INTO m05_tile_test_receipts('+
 'operation_id,purchase_id,actor_id,intent_hash,supplier_id,product_id,revision,'+
 'expected_stock_version,expected_catalog_version,received_pcs,boxes,extra_pieces,'+
 'pricing_unit,unit_price_text,line_amount_paisa,request_snapshot_json,'+
 'measurement_snapshot_json,price_snapshot_json,purchase_date) '+
 'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) '+
 'ON CONFLICT(operation_id) DO NOTHING RETURNING purchase_id,intent_hash,actor_id';

export const M05_TILE_RECEIVE_LOOKUP_SQL=
 'SELECT purchase_id,intent_hash,actor_id FROM m05_tile_test_receipts WHERE operation_id=?';
