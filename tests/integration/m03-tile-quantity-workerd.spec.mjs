import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {proposeTileQuantityCandidateD1} from '../../src/db/tile-quantity-d1-proposal.js';
import {seedSql,insertSql,row,values} from '../fixtures/m02-tile-measurement-rows.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
const seed=async (id,patch={})=>{
 await DB.batch(seedSql(id).map(({sql,args})=>DB.prepare(sql).bind(...args)));
 await DB.prepare(insertSql).bind(...values(row(id,patch))).run();
 await DB.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').bind(id).run();
};
const pack={mode:'pack',boxes:'2',extraPieces:'3'};
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());

test('real D1 persisted nominal tile proposes 53 Pcs and exact 106/3 Sqft, without writes',async()=>{
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM d1_migrations').first()).n,14);
 await seed('TILE-D1-PROP');
 const before=(await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n;
 const proposal=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-PROP',request:pack});
 assert.equal(proposal.quantity.pieces,'53');
 assert.deepEqual(proposal.quantity.actualSqft,{numerator:'106',denominator:'3'});
 assert.equal(proposal.quantity.measurementSnapshot.boxUnitName,'Carton');
 assert.equal(proposal.catalog.stockAuthority,'not-loaded');
 assert.equal(proposal.pricing.sellingPricingUnit,'Sqft');
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n,before);
});
test('real D1 35.50 Sqft requests propose 54 loose Pcs or 3 full Cartons with exact output',async()=>{
 const request={mode:'area',requestedSqft:'35.50',fulfillment:'loose'};
 const loose=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-PROP',request});
 const box=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-PROP',request:{...request,fulfillment:'box-only'}});
 assert.equal(loose.quantity.pieces,'54');
 assert.deepEqual(loose.quantity.actualSqft,{numerator:'36',denominator:'1'});
 assert.equal(box.quantity.pieces,'75');
 assert.equal(box.quantity.displaySqft,'50.00');
});
test('real D1 manufacturer selected coverage retains exact evidence and distinct nominal coverage',async()=>{
 await seed('TILE-D1-MFR',{coverage_policy:'manufacturer',
  manufacturer_sqft_per_box_text:'16.668',
  manufacturer_evidence_ref:'synthetic-product-label'});
 const result=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-MFR',request:{mode:'pack',boxes:'18',extraPieces:'0'}});
 assert.equal(result.quantity.pieces,'450');
 assert.equal(result.quantity.displaySqft,'300.02');
 assert.deepEqual(result.quantity.nominalSqft,{numerator:'300',denominator:'1'});
 assert.equal(result.quantity.measurementSnapshot.manufacturerEvidence,'synthetic-product-label');
});
test('real D1 historical 25-piece Carton is not silently replaced by current 24-piece Box',async()=>{
 await seed('TILE-D1-HIST');
 await DB.batch([
  DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('TILE-D1-HIST',2,'Pcs')"),
  DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('TILE-D1-HIST',2,'CTN','Box','24')"),
  DB.prepare(insertSql).bind(...values(row('TILE-D1-HIST',{revision:2,pieces_per_box:24,width_text:'12'}))),
  DB.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='TILE-D1-HIST'")
 ]);
 const old=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-HIST',revision:1,request:pack});
 const current=await proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-HIST',request:pack});
 assert.equal(old.quantity.pieces,'53');
 assert.equal(old.quantity.measurementSnapshot.boxUnitName,'Carton');
 assert.equal(old.isCurrent,false);
 assert.equal(current.quantity.pieces,'51');
 assert.equal(current.quantity.measurementSnapshot.boxUnitName,'Box');
 assert.equal(current.isCurrent,true);
});
test('real D1 lacks tile measurement returns null and invalid physical request fails closed',async()=>{
 assert.equal(await proposeTileQuantityCandidateD1({DB,productId:'D1-UNKNOWN',request:pack}),null);
 await assert.rejects(()=>proposeTileQuantityCandidateD1({DB,productId:'TILE-D1-PROP',
  request:{mode:'area',requestedSqft:'0',fulfillment:'loose'}}));
});
test('candidate adapter remains inaccessible through the Worker and cannot mutate the ledger',async()=>{
 for(const url of ['/api/rpc','/api/tiles','/__m03_tile_proposal__']){
  const res=await worker.fetch('https://synthetic.local'+url,{method:'POST',body:'{}'});
  assert.equal(res.status,404);
 }
});
