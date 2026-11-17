import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {insertSql,row,values,seedSql,invalidRows} from '../fixtures/m02-tile-measurement-rows.mjs';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());
const seed=async(id,rev=1,factor='25.000',base='Pcs')=>
  DB.batch(seedSql(id,rev,factor,base).map(({sql,args})=>DB.prepare(sql).bind(...args)));
const insert=value=>DB.prepare(insertSql).bind(...values(value));

test('clean real D1 applies all fourteen migrations and stores exact measurement evidence',async()=>{
  assert.equal((await DB.prepare('SELECT count(*) n FROM d1_migrations').first()).n,14);
  await seed('D1-EXACT');
  await insert(row('D1-EXACT',{length_text:'304.800000000001',dimension_unit:'mm',
    coverage_policy:'manufacturer',manufacturer_sqft_per_box_text:'16.668000',manufacturer_evidence_ref:'synthetic-label',purchase_sqft_price_override_text:'0'})).run();
  const out=await DB.prepare("SELECT * FROM product_tile_measurement_revisions WHERE product_id='D1-EXACT'").first();
  assert.equal(out.length_text,'304.800000000001');assert.equal(out.manufacturer_sqft_per_box_text,'16.668000');
  assert.equal(out.purchase_sqft_price_override_text,'0');assert.equal(out.pieces_per_box,25);
});

test('real D1 enforces decimal, policy, reference and exact pack constraints',async()=>{
  for(const [i,patch] of invalidRows.entries()){
    const id='D1-BAD-'+i;await seed(id);
    await assert.rejects(()=>insert(row(id,patch)).run(),/constraint|mismatch|datatype|integer|CHECK/i);
  }
  await seed('D1-FRACTION',1,'25.000000000001');
  await assert.rejects(()=>insert(row('D1-FRACTION')).run(),/mismatch|pack/i);
  await seed('D1-WIRE',1,'25','Gira');
  await assert.rejects(()=>insert(row('D1-WIRE')).run(),/mismatch|pack/i);
  await assert.rejects(()=>insert(row('NO-PARENT')).run(),/mismatch|constraint|pack/i);
});

test('real D1 preserves the original 25-piece measurement after a new 24-piece revision',async()=>{
  await seed('D1-HISTORY');await insert(row('D1-HISTORY')).run();
  await DB.batch([
    DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('D1-HISTORY',2,'Pcs')"),
    DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('D1-HISTORY',2,'CTN','Carton','24')"),
    insert(row('D1-HISTORY',{revision:2,pieces_per_box:24})),
    DB.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='D1-HISTORY'")
  ]);
  const all=(await DB.prepare("SELECT revision,pieces_per_box FROM product_tile_measurement_revisions WHERE product_id='D1-HISTORY' ORDER BY revision").all()).results;
  assert.deepEqual(all,[{revision:1,pieces_per_box:25},{revision:2,pieces_per_box:24}]);
  await assert.rejects(()=>DB.prepare("UPDATE product_tile_measurement_revisions SET pieces_per_box=24 WHERE product_id='D1-HISTORY' AND revision=1").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM product_tile_measurement_revisions WHERE product_id='D1-HISTORY'").run(),/immutable/i);
});

test('concurrent duplicate measurement inserts commit exactly one immutable revision',async()=>{
  await seed('D1-DUP');
  const results=await Promise.allSettled([insert(row('D1-DUP')).run(),insert(row('D1-DUP')).run()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal((await DB.prepare("SELECT count(*) n FROM product_tile_measurement_revisions WHERE product_id='D1-DUP'").first()).n,1);
});

test('a late real D1 batch constraint failure rolls back product, profile, pack and measurement',async()=>{
  const statements=seedSql('D1-ROLLBACK').map(({sql,args})=>DB.prepare(sql).bind(...args));
  statements.push(insert(row('D1-ROLLBACK')));
  statements.push(insert(row('D1-ROLLBACK',{revision:2})));
  await assert.rejects(()=>DB.batch(statements),/mismatch|constraint|pack/i);
  for(const table of ['products','product_unit_profiles','product_unit_conversions','product_tile_measurement_revisions'])
    assert.equal((await DB.prepare('SELECT count(*) n FROM '+table+" WHERE product_id='D1-ROLLBACK'").first()).n,0);
  assert.equal((await worker.fetch('https://synthetic.local/api/tiles')).status,404);
});
