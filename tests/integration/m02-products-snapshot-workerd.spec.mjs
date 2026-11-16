import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {CANONICAL_PRODUCT_HEADERS,SUPPLEMENTARY_PRODUCT_HEADERS,SUPPLEMENTARY_CONVERSION_HEADERS} from '../../src/db/product-source-contract.js';
import {importProductD1Snapshot} from '../../src/db/product-d1-snapshot-import.js';
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-products-snapshot-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-products-snapshot-local-only');
let DB;
const row=(headers,changes)=>headers.map(x=>changes[x]??'');
const canonical=()=>({headers:CANONICAL_PRODUCT_HEADERS,rows:[
 row(CANONICAL_PRODUCT_HEADERS,{'Product ID':'P-1','Product Name':'তারের রোল','Unit':'Gira','Barcode':'00088','Purchase Price':'4.375','Current Stock':'37.000','Product Type':'Bundle'}),
 row(CANONICAL_PRODUCT_HEADERS,{'Product ID':'P-2','Product Name':'তারের রোল','Unit':'Gira','Barcode':'00088','Purchase Price':'-0.00','Current Stock':'0.000'})
]});
const old=()=>({headers:SUPPLEMENTARY_PRODUCT_HEADERS,rows:[
 row(SUPPLEMENTARY_PRODUCT_HEADERS,{'Product ID':'P-1','Product Name':'তারের রোল','Unit':'Gira','Purchase Price Unit':'Gauge','Stock View Unit':'Gauge'})
]});
const conversions=()=>({headers:SUPPLEMENTARY_CONVERSION_HEADERS,rows:[
 row(SUPPLEMENTARY_CONVERSION_HEADERS,{'Conversion ID':'C-1','Product ID':'P-1','Unit Name':'Gauge','Conversion Factor':'16.000','Purchase Price':'70.000'}),
 row(SUPPLEMENTARY_CONVERSION_HEADERS,{'Conversion ID':'C-2','Product ID':'P-1','Unit Name':'Box','Conversion Factor':'20.000','Purchase Price':'90.000'})
]});
const count=async(t)=> (await DB.prepare('SELECT COUNT(*) n FROM '+t).first()).n;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());
test('source preflight rejects wrong input without any D1 write',async()=>{
 await assert.rejects(()=>importProductD1Snapshot({DB,profile:'canonical',productExport:old()}),/header|profile/i);
 await assert.rejects(()=>importProductD1Snapshot({DB,profile:'supplementary',productExport:old(),conversionExport:conversions()}),/review/i);
 assert.equal(await count('legacy_product_snapshots'),0);
});
test('late conversion failure rolls back both product and conversion inserts',async()=>{
 await DB.prepare("CREATE TRIGGER fail_second BEFORE INSERT ON legacy_product_unit_conversion_snapshots WHEN NEW.conversion_id='C-2' BEGIN SELECT RAISE(ABORT,'late synthetic failure'); END").run();
 try{
  await assert.rejects(()=>importProductD1Snapshot({DB,profile:'supplementary',
   explicitSupplementaryReview:true,productExport:old(),conversionExport:conversions()}),/failed|D1/i);
  assert.equal(await count('legacy_product_snapshots'),0);
  assert.equal(await count('legacy_product_unit_conversion_snapshots'),0);
 }finally{await DB.prepare('DROP TRIGGER fail_second').run();}
});
test('concurrent one-shot reviewed import has exactly one winner and immutable data',async()=>{
 const args={DB,profile:'supplementary',explicitSupplementaryReview:true,
  productExport:old(),conversionExport:conversions()};
 const winners=await Promise.allSettled([importProductD1Snapshot(args),importProductD1Snapshot(args)]);
 assert.deepEqual(winners.map(x=>x.status).sort(),['fulfilled','rejected']);
 assert.equal(await count('legacy_product_snapshots'),1);
 assert.equal(await count('legacy_product_unit_conversion_snapshots'),2);
 assert.equal((await DB.prepare('SELECT factor_text FROM legacy_product_unit_conversion_snapshots WHERE conversion_id=?').bind('C-1').first()).factor_text,'16.000');
 await assert.rejects(()=>DB.prepare("UPDATE legacy_product_snapshots SET product_name='forged'").run(),/immutable/i);
 await assert.rejects(()=>DB.prepare('DELETE FROM legacy_product_unit_conversion_snapshots').run(),/immutable/i);
});
test('replay and different snapshot denied; no live product/stock tables are mutated',async()=>{
 await assert.rejects(()=>importProductD1Snapshot({DB,profile:'supplementary',explicitSupplementaryReview:true,
  productExport:old(),conversionExport:conversions()}),/failed|D1/i);
 const changed=old();changed.rows[0][changed.headers.indexOf('Product Name')]='forged';
 await assert.rejects(()=>importProductD1Snapshot({DB,profile:'supplementary',explicitSupplementaryReview:true,
  productExport:changed,conversionExport:conversions()}),/failed|D1/i);
 assert.equal(await count('legacy_product_snapshots'),1);
 assert.equal((await DB.prepare('SELECT product_name FROM legacy_product_snapshots').first()).product_name,'তারের রোল');
});
test('isolated test Worker cannot expose product import or public RPC',async()=>{
 for(const route of ['/api/rpc','/products/import','/api/products']){
  const response=await worker.fetch('https://synthetic.example'+route,{method:'POST',body:'{}'});
  assert.equal(response.status,404);
 }
});
