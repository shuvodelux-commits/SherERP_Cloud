import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {readProductCatalogCandidateD1} from '../../src/db/product-catalog-d1-read.js';
import {resolveTileQuantityFromCatalog} from '../../src/modules/tile-quantity-contract.js';

// Existing catalog schema only. Measurements are supplied synthetic evidence,
// not a persisted or production-approved tile measurement table.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
const measurement={productId:'TILE-D1',revision:'1',baseUnit:'Pcs',
  boxConversionId:'CTN',length:'12',width:'8',dimensionUnit:'in',
  piecesPerBox:'25',coveragePolicy:'nominal'};
const request={mode:'pack',boxes:'2',extraPieces:'3'};

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  await DB.batch([
    DB.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name) VALUES('TILE-D1','new','Synthetic 8x12','Pcs')"),
    DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('TILE-D1',1,'Pcs')"),
    DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES('TILE-D1',2,'Pcs')"),
    DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('TILE-D1',1,'CTN','Carton','25.000')"),
    DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('TILE-D1',2,'CTN','Carton','24')"),
    DB.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='TILE-D1'")
  ]);
});
after(async()=>harness.close());

test('real D1 catalog supplies the exact physical tile pack and source label',async()=>{
  const candidate=await readProductCatalogCandidateD1({DB,productId:'TILE-D1'});
  const out=resolveTileQuantityFromCatalog(candidate,measurement,request);
  assert.equal(out.pieces,'53');
  assert.equal(out.unitSnapshot[0].unitName,'Carton');
  assert.deepEqual(out.actualSqft,{numerator:'106',denominator:'3'});
  const before=JSON.stringify(candidate);
  resolveTileQuantityFromCatalog(candidate,measurement,request);
  assert.equal(JSON.stringify(await readProductCatalogCandidateD1({DB,productId:'TILE-D1'})),before);
});

test('real D1 current revision changes to 24 while explicit historical pack remains 25',async()=>{
  await DB.prepare("UPDATE products SET current_unit_revision=2 WHERE product_id='TILE-D1'").run();
  const current=await readProductCatalogCandidateD1({DB,productId:'TILE-D1'});
  const historic=await readProductCatalogCandidateD1({DB,productId:'TILE-D1',revision:1});
  assert.equal(resolveTileQuantityFromCatalog(current,{...measurement,revision:'2',piecesPerBox:'24'},request).pieces,'51');
  assert.equal(resolveTileQuantityFromCatalog(historic,measurement,request).pieces,'53');
  assert.throws(()=>resolveTileQuantityFromCatalog(current,measurement,request),/catalog/i);
  assert.throws(()=>resolveTileQuantityFromCatalog(historic,{...measurement,piecesPerBox:'24'},request),/catalog/i);
  await assert.rejects(()=>DB.prepare("UPDATE product_unit_conversions SET factor_text='24' WHERE product_id='TILE-D1' AND revision=1").run(),/immutable/i);
});

test('tile contract cannot expose the existing isolated Worker over HTTP',async()=>{
  assert.equal((await worker.fetch('https://synthetic.local/api/rpc')).status,404);
  assert.equal((await worker.fetch('https://synthetic.local/api/tiles')).status,404);
});
