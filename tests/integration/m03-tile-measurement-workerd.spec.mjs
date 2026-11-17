import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {readTileMeasurementCandidateD1} from '../../src/db/tile-measurement-d1-read.js';
import {seedSql,insertSql,row,values} from '../fixtures/m02-tile-measurement-rows.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
const seed=async (id,factor='25.000')=>{
 await DB.batch(seedSql(id,1,factor).map(({sql,args})=>DB.prepare(sql).bind(...args)));
 await DB.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').bind(id).run();
};
const insert=value=>DB.prepare(insertSql).bind(...values(value)).run();

before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());

test('actual local D1 returns null for missing product or unconfigured tile',async()=>{
 assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first()).n,14);
 assert.equal(await readTileMeasurementCandidateD1({DB,productId:'NO-TILE'}),null);
 await seed('D1-UNTILED');
 assert.equal(await readTileMeasurementCandidateD1({DB,productId:'D1-UNTILED'}),null);
});
test('actual local D1 preserves exact text, Sqft override null/zero and original Carton label',async()=>{
 await seed('D1-TILE-READ');
 await insert(row('D1-TILE-READ',{length_text:'304.800000000001',
  dimension_unit:'mm',coverage_policy:'manufacturer',
  manufacturer_sqft_per_box_text:'16.668000',
  manufacturer_evidence_ref:'synthetic-manufacturer-label',
  purchase_sqft_price_override_text:'0.0000',
  selling_sqft_price_override_text:null}));
 const before=(await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n;
 const out=await readTileMeasurementCandidateD1({DB,productId:'D1-TILE-READ'});
 assert.equal(out.measurement.boxUnitName,'Carton');
 assert.equal(out.measurement.length,'304.800000000001');
 assert.equal(out.measurement.piecesPerBox,'25');
 assert.equal(out.measurement.manufacturerSqftPerBox,'16.668000');
 assert.equal(out.pricing.purchaseSqftPriceOverrideText,'0.0000');
 assert.equal(out.pricing.sellingSqftPriceOverrideText,null);
 assert.equal(out.catalog.stockAuthority,'not-loaded');
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM product_tile_measurement_revisions').first()).n,before);
});
test('actual local D1 reads 25-piece historical revision without misapplying current 24-piece pack',async()=>{
 await seed('D1-TILE-HISTORY');
 await insert(row('D1-TILE-HISTORY'));
 await DB.batch([
  DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('D1-TILE-HISTORY',2,'Pcs')"),
  DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,status) VALUES('D1-TILE-HISTORY',2,'CTN','Box','24','Inactive')"),
  DB.prepare(insertSql).bind(...values(row('D1-TILE-HISTORY',{revision:2,pieces_per_box:24,width_text:'12'}))),
  DB.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='D1-TILE-HISTORY'")
 ]);
 const historic=await readTileMeasurementCandidateD1({DB,productId:'D1-TILE-HISTORY',revision:1});
 const current=await readTileMeasurementCandidateD1({DB,productId:'D1-TILE-HISTORY'});
 assert.equal(historic.measurement.piecesPerBox,'25');
 assert.equal(historic.measurement.boxUnitName,'Carton');
 assert.equal(historic.isCurrent,false);
 assert.equal(current.measurement.piecesPerBox,'24');
 assert.equal(current.measurement.boxUnitName,'Box');
 assert.equal(current.catalog.unitConfig.conversions[0].status,'Inactive');
 assert.equal(current.isCurrent,true);
 await assert.rejects(()=>DB.prepare("UPDATE product_tile_measurement_revisions SET pieces_per_box=24 WHERE product_id='D1-TILE-HISTORY' AND revision=1").run(),/immutable/i);
});
test('isolated Workerd Worker exposes no tile reader or write API',async()=>{
 for(const url of ['/api/tiles','/api/rpc','/__m03_tile_measurement__']){
  const res=await worker.fetch('https://synthetic.local'+url,{method:'POST',body:'{}'});
  assert.equal(res.status,404);
 }
});
