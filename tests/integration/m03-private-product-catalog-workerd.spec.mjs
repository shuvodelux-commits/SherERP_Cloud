import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {readProductCatalogCandidateD1} from '../../src/db/product-catalog-d1-read.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());

test('real local D1 reads no unapproved product if candidate catalog empty',async()=>{
 assert.equal(await readProductCatalogCandidateD1({DB,productId:'P-UNKNOWN'}),null);
});
test('real local D1 preserves canonical snapshot identity and exact barcode/factor text',async()=>{
 await DB.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text,current_stock_text) VALUES('canonical',2,'P-0001','Gira','37.000')").run();
 await DB.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name,barcode_text,purchase_price_text,selling_price_text) VALUES('P-0001','canonical',1,2,'তার','Gira','00010','4.375','25.000')").run();
 let got=await readProductCatalogCandidateD1({DB,productId:'P-0001'});
 assert.equal(got.sourceProfile,'canonical');assert.equal(got.legacySheetRow,2);
 assert.equal(got.purchasePriceText,'4.375');assert.equal(got.barcodeText,'00010');
 assert.equal(got.unitConfig.revision,0);assert.deepEqual(got.unitConfig.conversions,[]);
 await DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,selling_anchor_unit_name) VALUES('P-0001',1,'Gira','Gauge','Gira')").run();
 await DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text,selling_price_override_text,sort_order,status) VALUES('P-0001',1,'CG','Gauge','16.000','70.000','400.00',1,'Inactive')").run();
 await DB.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='P-0001'").run();
 got=await readProductCatalogCandidateD1({DB,productId:'P-0001'});
 assert.equal(got.unitConfig.conversions[0].factorText,'16.000');
 assert.equal(got.unitConfig.conversions[0].purchasePriceOverrideText,'70.000');
 assert.equal(got.unitConfig.conversions[0].status,'Inactive');
 assert.equal(got.stockAuthority,'not-loaded');
 await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'P-0001',revision:2}),/revision|NEEDS_REVIEW/);
});
test('read-only adapter writes nothing and test worker exposes no source data over HTTP',async()=>{
 const before=(await DB.prepare('SELECT COUNT(*) n FROM products').first()).n;
 const snapshot=(await DB.prepare('SELECT COUNT(*) n FROM legacy_product_snapshots').first()).n;
 await readProductCatalogCandidateD1({DB,productId:'P-0001',revision:1});
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM products').first()).n,before);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM legacy_product_snapshots').first()).n,snapshot);
 for(const url of ['/api/rpc','/products','/api/products','/__m03_product_catalog__']){
  const res=await worker.fetch('https://fixture.local'+url,{method:'POST',body:'{}'});
  assert.equal(res.status,404);
 }
});
