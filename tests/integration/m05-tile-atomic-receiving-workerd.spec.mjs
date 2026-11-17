import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {M05_TILE_RECEIVE_DDL} from '../fixtures/m05-tile-receiving-schema.mjs';
import {createSyntheticTileReceivingPoster} from '../fixtures/m05-tile-receiving-contract.mjs';
import {row,insertSql,values} from '../fixtures/m02-tile-measurement-rows.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
const pack={mode:'pack',boxes:'2',extraPieces:'3'};
const poster=(options)=>createSyntheticTileReceivingPoster(DB,options);
const input=(op,productId,patch={})=>({
 actorId:'ACT-1',operationId:op,purchaseId:'PUR-'+op,
 supplierId:'SUP-1',productId,expectedStockVersion:1,
 expectedCatalogVersion:0,purchaseDate:'2026-11-17',request:{...pack},
 ...patch
});
const scalar=async sql=>DB.prepare(sql).first();
const all=async sql=>(await DB.prepare(sql).all()).results;
async function seed(id,{price='',anchor='',stockOverride='',packOverride='',
 pricingUnit='Sqft',sqftPrice='38.00',manufacturer=false}={}){
 await DB.batch([
  DB.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,purchase_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)").bind(id,price),
  DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,stock_purchase_override_text) VALUES(?,1,'Pcs',?,?)").bind(id,anchor,stockOverride),
  DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)").bind(id,packOverride),
  DB.prepare(insertSql).bind(...values(row(id,{
   purchase_pricing_unit:pricingUnit,purchase_sqft_price_override_text:sqftPrice,
   ...(manufacturer?{coverage_policy:'manufacturer',
    manufacturer_sqft_per_box_text:'16.668',manufacturer_evidence_ref:'synthetic-verified-label'}:{})
  }))),
  DB.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').bind(id),
  DB.prepare("INSERT INTO m05_tile_test_stock(product_id,pcs,version) VALUES(?,10,1)").bind(id)
 ]);
}
before(async()=>{
 await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());
 for(const sql of M05_TILE_RECEIVE_DDL)await DB.prepare(sql).run();
 await DB.batch([
  DB.prepare("INSERT INTO m05_tile_test_sessions VALUES('TEST-SHOP','Open')"),
  DB.prepare("INSERT INTO m05_tile_test_suppliers VALUES('SUP-1','PARTY-1',1,4000)"),
  DB.prepare("INSERT INTO m05_tile_test_supplier_links VALUES('SUP-1','PARTY-1',1)"),
  DB.prepare("INSERT INTO m05_tile_test_customer_ar VALUES('PARTY-1',9000)")
 ]);
});
after(async()=>harness.close());

test('local real D1: one credit purchase atomically posts 53 Pcs, source lot date, exact Sqft amount and separate supplier due',async()=>{
 assert.equal((await scalar('SELECT COUNT(*) n FROM d1_migrations')).n,14);
 await seed('M05-TILE-RECEIPT');
 const claim=await poster().post(input('OP-TILE-RECEIPT-001','M05-TILE-RECEIPT'));
 assert.deepEqual(claim,{status:'COMMITTED',operationId:'OP-TILE-RECEIPT-001',purchaseId:'PUR-OP-TILE-RECEIPT-001'});
 assert.deepEqual(await scalar("SELECT pcs,version FROM m05_tile_test_stock WHERE product_id='M05-TILE-RECEIPT'"),{pcs:63,version:2});
 const lot=await scalar("SELECT supplier_id,received_pcs,revision,line_amount_paisa,purchase_date,measurement_snapshot_json,request_snapshot_json FROM m05_tile_test_lots WHERE product_id='M05-TILE-RECEIPT'");
 assert.equal(lot.supplier_id,'SUP-1');assert.equal(lot.received_pcs,53);
 assert.equal(lot.revision,1);assert.equal(lot.line_amount_paisa,134267);
 assert.equal(lot.purchase_date,'2026-11-17');
 assert.equal(JSON.parse(lot.measurement_snapshot_json).boxUnitName,'Carton');
 assert.deepEqual(JSON.parse(lot.request_snapshot_json),pack);
 assert.deepEqual(await all("SELECT units_in,stock_after FROM m05_tile_test_movements WHERE product_id='M05-TILE-RECEIPT'"),[{units_in:53,stock_after:63}]);
 assert.equal((await scalar("SELECT debit_paisa FROM m05_tile_test_supplier_ledger WHERE purchase_id='PUR-OP-TILE-RECEIPT-001'")).debit_paisa,134267);
 assert.equal((await scalar("SELECT payable_paisa FROM m05_tile_test_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,138267);
 assert.equal((await scalar("SELECT receivable_paisa FROM m05_tile_test_customer_ar WHERE party_id='PARTY-1'")).receivable_paisa,9000);
});
test('identical operation replay is exactly once; changed request and actor conflict',async()=>{
 const request=input('OP-TILE-RECEIPT-001','M05-TILE-RECEIPT');
 const before=await scalar("SELECT COUNT(*) n FROM m05_tile_test_lots");
 assert.equal((await poster().post(request)).status,'REPLAY');
 assert.equal((await poster().post({...request,request:{mode:'pack',boxes:'3',extraPieces:'3'}})).status,'CONFLICT');
 assert.equal((await poster().post({...request,actorId:'ACT-OTHER'})).status,'CONFLICT');
 assert.equal((await scalar('SELECT COUNT(*) n FROM m05_tile_test_lots')).n,before.n);
 assert.equal((await scalar("SELECT pcs FROM m05_tile_test_stock WHERE product_id='M05-TILE-RECEIPT'")).pcs,63);
});
test('Box, Pcs and manufacturer-Sqft purchase prices preserve exact line totals and canonical Pcs',async()=>{
 await seed('M05-TILE-BOX',{price:'600.0000',anchor:'Carton',packOverride:'600.00',pricingUnit:'Box',sqftPrice:null});
 await seed('M05-TILE-PCS',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs',sqftPrice:null});
 await seed('M05-TILE-MFR',{manufacturer:true});
 for(const [op,productId,req,amount,pcs] of [
  ['OP-TILE-BOX-001','M05-TILE-BOX',pack,127200,53],
  ['OP-TILE-PCS-001','M05-TILE-PCS',pack,27825,53],
  ['OP-TILE-MFR-001','M05-TILE-MFR',{mode:'pack',boxes:'18',extraPieces:'0'},1140091,450]
 ]){
  assert.equal((await poster().post(input(op,productId,{request:req}))).status,'COMMITTED');
  assert.deepEqual(await scalar("SELECT received_pcs,line_amount_paisa FROM m05_tile_test_lots WHERE purchase_id='PUR-"+op+"'"),{
   received_pcs:pcs,line_amount_paisa:amount
  });
 }
});
test('area-entry receiving, price authority overrides and malformed physical claims fail before stock writes',async()=>{
 await seed('M05-TILE-MODE');
 for(const request of [
  {mode:'area',requestedSqft:'35.50',fulfillment:'loose'},
  {mode:'pack',boxes:'0',extraPieces:'0'},
  {mode:'pack',boxes:'1.5',extraPieces:'0'}
 ]) await assert.rejects(()=>poster().post(input('OP-TILE-MODE-001','M05-TILE-MODE',{request})));
 assert.equal((await scalar("SELECT pcs FROM m05_tile_test_stock WHERE product_id='M05-TILE-MODE'")).pcs,10);
});
test('changed price or unit revision after read is rejected by the SQL statement, with zero receipt/lot/ledger effects',async()=>{
 await seed('M05-TILE-STALE-PRICE');
 await assert.rejects(()=>poster({beforeBatch:async()=>{
  await DB.prepare("UPDATE product_tile_measurement_revisions SET purchase_sqft_price_override_text='39.00' WHERE product_id='M05-TILE-STALE-PRICE'").run();
 }}).post(input('OP-TILE-STALE-PRICE-001','M05-TILE-STALE-PRICE')),/NEEDS_REVIEW|immutable/);
 // Immutable measurement writes are rejected; changing mutable canonical product metadata is the meaningful race.
 await seed('M05-TILE-STALE-VERSION',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs',sqftPrice:null});
 await assert.rejects(()=>poster({beforeBatch:async()=>{
  await DB.prepare("UPDATE products SET purchase_price_text='5.26' WHERE product_id='M05-TILE-STALE-VERSION'").run();
 }}).post(input('OP-TILE-STALE-VERSION-001','M05-TILE-STALE-VERSION')),/NEEDS_REVIEW/);
 assert.equal((await scalar("SELECT pcs FROM m05_tile_test_stock WHERE product_id='M05-TILE-STALE-VERSION'")).pcs,10);
 assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_receipts WHERE product_id='M05-TILE-STALE-VERSION'")).n,0);
});
test('unreviewed supplier link, inactive supplier and closed session are SQL-level blockers',async()=>{
 await seed('M05-TILE-PARTY');
 const variants=[
  ["UPDATE m05_tile_test_supplier_links SET reviewed=0 WHERE supplier_id='SUP-1'","UPDATE m05_tile_test_supplier_links SET reviewed=1 WHERE supplier_id='SUP-1'"],
  ["UPDATE m05_tile_test_suppliers SET active=0 WHERE supplier_id='SUP-1'","UPDATE m05_tile_test_suppliers SET active=1 WHERE supplier_id='SUP-1'"],
  ["UPDATE m05_tile_test_sessions SET state='Closed' WHERE shop_id='TEST-SHOP'","UPDATE m05_tile_test_sessions SET state='Open' WHERE shop_id='TEST-SHOP'"]
 ];
 for(const [i,[change,restore]] of variants.entries()){
  await DB.prepare(change).run();
  await assert.rejects(()=>poster().post(input('OP-TILE-PARTY-00'+i,'M05-TILE-PARTY')),/NEEDS_REVIEW/);
  await DB.prepare(restore).run();
 }
 assert.equal((await scalar("SELECT pcs FROM m05_tile_test_stock WHERE product_id='M05-TILE-PARTY'")).pcs,10);
 assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_receipts WHERE product_id='M05-TILE-PARTY'")).n,0);
});
test('competing operation IDs using one expected stock version commit at most once',async()=>{
 await seed('M05-TILE-RACE');
 const result=await Promise.allSettled([
  poster().post(input('OP-TILE-RACE-0001','M05-TILE-RACE')),
  poster().post(input('OP-TILE-RACE-0002','M05-TILE-RACE'))
 ]);
 const ok=result.filter(x=>x.status==='fulfilled'&&x.value.status==='COMMITTED');
 assert.equal(ok.length,1);
 assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_receipts WHERE product_id='M05-TILE-RACE'")).n,1);
 assert.deepEqual(await scalar("SELECT pcs,version FROM m05_tile_test_stock WHERE product_id='M05-TILE-RACE'"),{pcs:63,version:2});
});
test('late supplier-ledger insertion error aborts entire receipt, stock, lot, movement and payable',async()=>{
 await seed('M05-TILE-ROLLBACK');
 const before=await scalar("SELECT payable_paisa FROM m05_tile_test_suppliers WHERE supplier_id='SUP-1'");
 await DB.prepare("CREATE TRIGGER m05_tile_test_injected_failure BEFORE INSERT ON m05_tile_test_supplier_ledger WHEN NEW.purchase_id='PUR-OP-TILE-FAIL-0001' BEGIN SELECT RAISE(ABORT,'injected-late-ledger-failure'); END").run();
 try {
  await assert.rejects(()=>poster().post(input('OP-TILE-FAIL-0001','M05-TILE-ROLLBACK')),/NEEDS_REVIEW/);
  assert.equal((await scalar("SELECT pcs FROM m05_tile_test_stock WHERE product_id='M05-TILE-ROLLBACK'")).pcs,10);
  assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_receipts WHERE product_id='M05-TILE-ROLLBACK'")).n,0);
  assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_lots WHERE product_id='M05-TILE-ROLLBACK'")).n,0);
  assert.equal((await scalar("SELECT COUNT(*) n FROM m05_tile_test_movements WHERE product_id='M05-TILE-ROLLBACK'")).n,0);
  assert.equal((await scalar("SELECT payable_paisa FROM m05_tile_test_suppliers WHERE supplier_id='SUP-1'")).payable_paisa,before.payable_paisa);
 }finally{
  await DB.prepare('DROP TRIGGER IF EXISTS m05_tile_test_injected_failure').run();
 }
});
test('receipt and historical lot are immutable and private Workerd paths have no posting capability',async()=>{
 await assert.rejects(()=>DB.prepare("DELETE FROM m05_tile_test_receipts WHERE operation_id='OP-TILE-RECEIPT-001'").run(),/immutable/i);
 await assert.rejects(()=>DB.prepare("UPDATE m05_tile_test_lots SET received_pcs=1 WHERE purchase_id='PUR-OP-TILE-RECEIPT-001'").run(),/immutable/i);
 for(const path of ['/api/rpc','/api/tiles/purchase','/__m05_tile_receiving__']){
  assert.equal((await worker.fetch('https://synthetic.local'+path,{method:'POST',body:'{}'})).status,404);
 }
});