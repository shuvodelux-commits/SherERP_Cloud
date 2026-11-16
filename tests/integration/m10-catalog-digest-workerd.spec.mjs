import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {summarizeM10Catalog} from '../../src/migration/m10-catalog-digest.js';
import {importSourceProductCategoriesWithD1} from '../../src/db/product-category-source-import.js';
import {importSourceProductUnitsWithD1} from '../../src/db/product-unit-source-import.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';
import {readFileSync} from 'node:fs';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-units-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-units-import-local-only');
let DB;

const categories=()=>[
  {'Category ID':'CAT-000001','Category Name':'ইলেকট্রিক',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'CAT-000002','Category Name':'ইলেকট্রিক',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];
const units=()=>[
  {'Unit ID':'UNT-000001','Unit Name':'গিরা',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Unit ID':'UNT-000002','Unit Name':'Feet',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];
const digest=(sheetKey,rows)=>summarizeM10Catalog({inventory,sheetKey,rows});
const getRows=sheetKey=>createLegacyCatalogReadAdapter({DB}).getAllRows_(sheetKey);

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('M10 independently hashes original rows and real persisted local Workerd/D1 readback',async()=>{
  const originals=[['PRODUCT_CATEGORIES',categories()],['PRODUCT_UNITS',units()]];
  const counts=await Promise.all([
    DB.prepare('SELECT COUNT(*) AS n FROM product_categories').first(),
    DB.prepare('SELECT COUNT(*) AS n FROM product_units').first()
  ]);
  assert.deepEqual(counts.map(x=>x.n),[0,0]);
  await importSourceProductCategoriesWithD1({DB,sourceRows:originals[0][1]});
  await importSourceProductUnitsWithD1({DB,sourceRows:originals[1][1]});
  for(const [key,rows] of originals){
    const persisted=await getRows(key);
    assert.notStrictEqual(persisted,rows,'must read actual D1 result, not source array');
    const fromSource=digest(key,rows),fromD1=digest(key,persisted);
    assert.equal(fromSource.rowCount,persisted.length);
    assert.ok(fromSource.rowDigest===fromD1.rowDigest,'D1 row digest must match independently');
    assert.ok(fromSource.idDigest===fromD1.idDigest,'D1 ID digest must match independently');
  }
});

test('direct persisted D1 content drift is detected without falsely changing source-ID evidence',async()=>{
  const before=digest('PRODUCT_CATEGORIES',categories());
  const result=await DB.prepare('UPDATE product_categories SET category_name=? WHERE category_id=?')
    .bind('বৈদ্যুতিক','CAT-000002').run();
  assert.equal(result.meta.changes,1);
  const after=digest('PRODUCT_CATEGORIES',await getRows('PRODUCT_CATEGORIES'));
  assert.ok(after.rowDigest!==before.rowDigest,'SQL tamper must change row digest');
  assert.ok(after.idDigest===before.idDigest,'unchanged original IDs must retain ID digest');
});

test('direct persisted D1 source ID drift is detected separately from field drift',async()=>{
  const before=digest('PRODUCT_UNITS',units());
  const result=await DB.prepare('UPDATE product_units SET unit_id=? WHERE unit_id=?')
    .bind('UNT-000999','UNT-000001').run();
  assert.equal(result.meta.changes,1);
  const after=digest('PRODUCT_UNITS',await getRows('PRODUCT_UNITS'));
  assert.ok(after.idDigest!==before.idDigest,'original source ID mismatch must be caught');
  assert.ok(after.rowDigest!==before.rowDigest,'changed source ID is part of full-row digest');
});

test('test fixture cannot expose private migration or RPC surface over HTTP',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m10__/snapshot']){
    const response=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});
