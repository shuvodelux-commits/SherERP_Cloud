import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());
const count=async(table)=>(await DB.prepare('SELECT count(*) n FROM '+table).first()).n;
test('D1 migration 0013 contains a new empty inert operational catalog',async()=>{
 assert.equal((await DB.prepare('SELECT count(*) n FROM d1_migrations').first()).n,13);
 for(const table of ['products','product_unit_profiles','product_unit_conversions'])assert.equal(await count(table),0);
});
test('canonical product identity is tied to original source row, not matching name or barcode',async()=>{
 await DB.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text,barcode_text) VALUES('canonical',2,'P-CAN','Gira','00099')").run();
 await assert.rejects(()=>DB.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name) VALUES('P-FAKE','canonical',1,2,'তার','Gira')").run(),/provenance|source/i);
 await DB.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name,barcode_text) VALUES('P-CAN','canonical',1,2,'তার','Gira','00099')").run();
 assert.equal((await DB.prepare("SELECT count(*) n FROM products WHERE product_id='P-CAN'").first()).n,1);
});
test('SQLite atomic D1 batch rolls back a product and first profile after late conversion failure',async()=>{
 const statements=[
   DB.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name) VALUES('P-BATCH','new','Wire','Gira')"),
   DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('P-BATCH',1,'Gira')"),
   DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('P-BATCH',1,'C-1','Gauge','16')"),
   DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('P-BATCH',2,'C-2','Box','20')")
 ];
 await assert.rejects(()=>DB.batch(statements),/foreign key|constraint/i);
 assert.equal((await DB.prepare("SELECT count(*) n FROM products WHERE product_id='P-BATCH'").first()).n,0);
 assert.equal((await DB.prepare("SELECT count(*) n FROM product_unit_profiles WHERE product_id='P-BATCH'").first()).n,0);
 assert.equal((await DB.prepare("SELECT count(*) n FROM product_unit_conversions WHERE product_id='P-BATCH'").first()).n,0);
});
test('D1 retains immutable conversion revisions while changing only the current pointer',async()=>{
 await DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name) VALUES('P-CAN',1,'Gira','Gauge')").run();
 await DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES('P-CAN',1,'C-GAUGE','Gauge','16.000','70.000')").run();
 await DB.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='P-CAN'").run();
 await assert.rejects(()=>DB.prepare("UPDATE product_unit_conversions SET factor_text='20' WHERE conversion_id='C-GAUGE'").run(),/immutable/i);
 await assert.rejects(()=>DB.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='P-CAN'").run(),/revision|missing/i);
 assert.equal((await DB.prepare("SELECT factor_text FROM product_unit_conversions WHERE conversion_id='C-GAUGE'").first()).factor_text,'16.000');
});
test('only isolated local test Worker exists; no product HTTP or public RPC',async()=>{
 for(const path of ['/api/rpc','/api/products','/__m02_test__/products']){
  const result=await worker.fetch('https://synthetic.local'+path,{method:'POST',body:'{}'});
  assert.equal(result.status,404);
 }
});
