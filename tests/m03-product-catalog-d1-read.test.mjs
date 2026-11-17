import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {readProductCatalogCandidateD1} from '../src/db/product-catalog-d1-read.js';

const schema=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function local(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_core_catalog.sql','0012_legacy_product_snapshots.sql','0013_product_catalog_revisions.sql'])db.exec(schema(f));
 const sqls=[];
 const DB={prepare(sql){
  sqls.push(sql);
  const stmt=db.prepare(sql);
  return {bind(...params){return {
   first:async()=>stmt.get(...params)??null,
   all:async()=>({success:true,results:stmt.all(...params)})
  }}};
 }};
 return {db,DB,sqls};
}
function seed(db){
 db.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,product_name,unit_text,barcode_text,current_stock_text) VALUES('canonical',2,'P-001','তার','Gira','000123','37.000')").run();
 db.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,product_name,unit_text,barcode_text,current_stock_text) VALUES('supplementary',2,'P-001','Older','Feet','000123','999')").run();
 db.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name,barcode_text,purchase_price_text,selling_price_text,opening_stock_text) VALUES('P-001','canonical',1,2,'তার','Gira','000123','4.375','25.000','37.000')").run();
}
test('private reader rejects bad inputs and never interpolates hostile IDs into SQL',async()=>{
 const {db,DB,sqls}=local();try{
  await assert.rejects(()=>readProductCatalogCandidateD1({DB:null,productId:'P-001'}),/D1|binding/i);
  await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'  '}),/Product ID|invalid/i);
  await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'P-001',revision:-1}),/revision/i);
  await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'P-001',revision:'1'}),/revision/i);
  assert.equal(await readProductCatalogCandidateD1({DB,productId:"P-001' OR 1=1 --"}),null);
  assert.ok(sqls.length>0);
  assert.ok(sqls.every(sql=>!sql.includes("1=1 --")));
 }finally{db.close();}
});
test('canonical source identity and text are retained without stock or older-profile identity',async()=>{
 const {db,DB}=local();try{
  seed(db);
  const before=db.prepare('SELECT total_changes() n').get().n;
  const got=await readProductCatalogCandidateD1({DB,productId:'P-001'});
  assert.equal(got.productId,'P-001');
  assert.equal(got.sourceProfile,'canonical');
  assert.equal(got.legacySheetRow,2);
  assert.equal(got.baseUnitName,'Gira');
  assert.equal(got.barcodeText,'000123');
  assert.equal(got.purchasePriceText,'4.375');
  assert.equal(got.sellingPriceText,'25.000');
  assert.equal(got.currentUnitRevision,0);
  assert.equal(got.unitConfig.revision,0);
  assert.deepEqual(got.unitConfig.conversions,[]);
  assert.equal(got.stockAuthority,'not-loaded');
  assert.equal(Object.hasOwn(got,'currentStock'),false);
  assert.equal(Object.hasOwn(got,'availableStock'),false);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(db.prepare("SELECT current_stock_text FROM legacy_product_snapshots WHERE source_profile='supplementary'").get().current_stock_text,'999');
 }finally{db.close();}
});
test('active and historical unit revisions preserve exact factor, price and inactive labels',async()=>{
 const {db,DB}=local();try{
  seed(db);
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,selling_anchor_unit_name,stock_view_unit_name) VALUES('P-001',1,'Gira','Gauge','Gira','Gauge')").run();
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,relation_qty_text,relation_unit_name,purchase_price_override_text,selling_price_override_text,sort_order,status) VALUES('P-001',1,'C-G','Gauge','16.000','16','Gira','70.000','400.00',1,'Inactive')").run();
  db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('P-001',2,'Gira')").run();
  db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,sort_order,status) VALUES('P-001',2,'C-X','Box','20',3,'Active')").run();
  db.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='P-001'").run();
  const active=await readProductCatalogCandidateD1({DB,productId:'P-001'});
  assert.equal(active.currentUnitRevision,2);
  assert.equal(active.unitConfig.revision,2);
  assert.equal(active.unitConfig.conversions[0].factorText,'20');
  const historical=await readProductCatalogCandidateD1({DB,productId:'P-001',revision:1});
  assert.equal(historical.currentUnitRevision,2);
  assert.equal(historical.unitConfig.revision,1);
  assert.equal(historical.unitConfig.purchaseAnchorUnitName,'Gauge');
  assert.equal(historical.unitConfig.conversions[0].factorText,'16.000');
  assert.equal(historical.unitConfig.conversions[0].purchasePriceOverrideText,'70.000');
  assert.equal(historical.unitConfig.conversions[0].sellingPriceOverrideText,'400.00');
  assert.equal(historical.unitConfig.conversions[0].status,'Inactive');
 }finally{db.close();}
});
test('missing revision or D1 failure is rejected, not presented as base-unit fallback',async()=>{
 const {db,DB}=local();try{
  seed(db);
  await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'P-001',revision:99}),/NEEDS_REVIEW|revision/i);
  await assert.rejects(()=>readProductCatalogCandidateD1({
   DB:{prepare(){throw new Error('offline')}} ,productId:'P-001'
  }),/NEEDS_REVIEW|unavailable/i);
  await assert.rejects(()=>readProductCatalogCandidateD1({DB:{
   prepare(){return {bind(){return {first:async()=>({product_id:'P-001',current_unit_revision:1}),all:async()=>({success:false,results:[]})}}}}
  },productId:'P-001'}),/NEEDS_REVIEW|incomplete|unavailable/i);
 }finally{db.close();}
});
test('private candidate reader is not publicly enabled by Worker or RPC',()=>{
 const content=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
  readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(content,/readProductCatalogCandidateD1|product-catalog-d1-read/);
});
