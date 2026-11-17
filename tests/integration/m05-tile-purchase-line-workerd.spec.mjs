import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {previewTilePurchaseLineCandidateD1} from '../../src/modules/m05-tile-purchase-line-preview.js';
import {row,insertSql,values} from '../fixtures/m02-tile-measurement-rows.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
const pack={mode:'pack',boxes:'2',extraPieces:'3'};

async function seed(id,{price='',anchor='',stockOverride='',packOverride='',
  pricingUnit='Sqft',sqftPrice='38.00',manufacturer=false}={}){
 await DB.batch([
  DB.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,purchase_price_text) VALUES(?,'new','Synthetic tile','Pcs',?)").bind(id,price),
  DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,stock_purchase_override_text) VALUES(?,1,'Pcs',?,?)").bind(id,anchor,stockOverride),
  DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text) VALUES(?,1,'CTN','Carton','25.000',?)").bind(id,packOverride),
  DB.prepare(insertSql).bind(...values(row(id,{
   purchase_pricing_unit:pricingUnit,purchase_sqft_price_override_text:sqftPrice,
   ...(manufacturer?{coverage_policy:'manufacturer',manufacturer_sqft_per_box_text:'16.668',manufacturer_evidence_ref:'synthetic-label'}:{})
  }))),
  DB.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id=?").bind(id)
 ]);
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());

test('real Workerd D1 persisted Sqft price quotes exact 53 Pcs and BDT 1342.67 without writes',async()=>{
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,14);
 await seed('M05-D1-SQFT');
 const before=(await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n;
 const q=await previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-SQFT',request:pack});
 assert.equal(q.purchasePreview.receivedPcs,'53');
 assert.equal(q.purchasePreview.lineAmountMinor,'134267');
 assert.equal(q.purchasePreview.postingAllowed,false);
 assert.deepEqual(q.purchasePreview.billingQuantity,{numerator:'106',denominator:'3'});
 assert.equal(q.quantity.measurementSnapshot.boxUnitName,'Carton');
 assert.equal(q.catalog.stockAuthority,'not-loaded');
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n,before);
});
test('real Workerd D1 Box and Pcs anchors preserve source price and original Carton pack',async()=>{
 await seed('M05-D1-BOX',{price:'600.0000',anchor:'Carton',packOverride:'600.00',pricingUnit:'Box'});
 await seed('M05-D1-PCS',{price:'5.25',anchor:'Pcs',pricingUnit:'Pcs'});
 const box=await previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-BOX',request:pack});
 const pcs=await previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-PCS',request:pack});
 assert.equal(box.purchasePreview.pricingUnit,'Box');
 assert.equal(box.purchasePreview.lineAmountMinor,'127200');
 assert.equal(box.purchasePreview.receivedPcs,'53');
 assert.equal(pcs.purchasePreview.pricingUnit,'Pcs');
 assert.equal(pcs.purchasePreview.lineAmountMinor,'27825');
 assert.equal(pcs.purchasePreview.receivedPcs,'53');
});
test('real Workerd D1 35.50 Sqft requested computes whole 54 received Pcs',async()=>{
 const result=await previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-SQFT',
  request:{mode:'area',requestedSqft:'35.50',fulfillment:'loose'}});
 assert.equal(result.purchasePreview.receivedPcs,'54');
 assert.equal(result.purchasePreview.lineAmountMinor,'136800');
 assert.deepEqual(result.quantity.actualSqft,{numerator:'36',denominator:'1'});
});
test('real Workerd D1 manufacturer label persists and prices selected effective area',async()=>{
 await seed('M05-D1-MFR',{manufacturer:true});
 const result=await previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-MFR',
  request:{mode:'pack',boxes:'18',extraPieces:'0'}});
 assert.equal(result.purchasePreview.receivedPcs,'450');
 assert.equal(result.purchasePreview.lineAmountMinor,'1140091');
 assert.equal(result.quantity.displaySqft,'300.02');
 assert.equal(result.quantity.measurementSnapshot.manufacturerEvidence,'synthetic-label');
});
test('real Workerd D1 missing Sqft purchase price fails closed and inactive product is not quoted',async()=>{
 await seed('M05-D1-NO-PRICE',{sqftPrice:null});
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-NO-PRICE',request:pack}),/NEEDS_REVIEW/);
 await DB.prepare("UPDATE products SET status='Inactive' WHERE product_id='M05-D1-SQFT'").run();
 await assert.rejects(()=>previewTilePurchaseLineCandidateD1({DB,productId:'M05-D1-SQFT',request:pack}),/NEEDS_REVIEW/);
});
test('isolated test Worker cannot publish tile purchase quoting or posting',async()=>{
 for(const path of ['/api/rpc','/api/tiles/purchase','/__m05_tile_purchase__']){
  assert.equal((await worker.fetch('https://synthetic.local'+path,{method:'POST',body:'{}'})).status,404);
 }
});
