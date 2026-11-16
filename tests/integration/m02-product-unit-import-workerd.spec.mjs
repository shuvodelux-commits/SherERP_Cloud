import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceProductUnitsWithD1} from '../../src/db/product-unit-source-import.js';
import {createLegacyCatalogReadAdapter} from '../../src/db/legacy-catalog-read.js';
import {createGuardedCatalogUpdateAdapter} from '../../src/db/legacy-catalog-update.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-units-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-units-import-local-only');
let DB;

const source=()=>[
  {'Unit ID':'UNT-SRC-001','Unit Name':'Pcs',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Unit ID':'UNT-SRC-002','Unit Name':'গিরা',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];
const count=async()=> (await DB.prepare('SELECT COUNT(*) AS n FROM product_units').first()).n;
const persisted=async()=> (await DB.prepare(`SELECT legacy_sheet_row,unit_id,unit_name,status,created_at
  FROM product_units ORDER BY legacy_sheet_row ASC`).all()).results;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('offline import validates complete source row identity, field order and physical positions before any write',async()=>{
  const input=source();
  const invalid=[
    [],
    [{...input[0],_rowIndex:3},input[1]],
    [input[1],input[0]],
    [{...input[0],'Unit ID':''},input[1]],
    [input[0],{...input[1],'Unit ID':'UNT-SRC-001'}],
    [input[0],{...input[1],Status:'Suspended'}],
    [{...input[0],Token:'private'},input[1]],
    [input[0],{...input[1],'Unit Name':{toString(){throw Error('attacker');}}}],
  ];
  for(const bad of invalid){
    await assert.rejects(()=>importSourceProductUnitsWithD1({DB,sourceRows:bad}),/source|import|field|row|invalid|duplicate|status/i);
    assert.equal(await count(),0);
  }
});

test('late SQL failure in second original unit atomically rolls back the first',async()=>{
  await DB.prepare(`CREATE TRIGGER test_m02_late_failure
    BEFORE INSERT ON product_units
    WHEN NEW.unit_id='UNT-SRC-002'
    BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END`).run();
  try{
    await assert.rejects(()=>importSourceProductUnitsWithD1({DB,sourceRows:source()}),/D1|failed|import/i);
    assert.equal(await count(),0,'no partial source import may survive');
  }finally{
    await DB.prepare('DROP TRIGGER test_m02_late_failure').run();
  }
});

test('two concurrent imports of same frozen source snapshot yield one complete winner',async()=>{
  const input=source();
  const unchanged=JSON.stringify(input);
  const results=await Promise.allSettled([
    importSourceProductUnitsWithD1({DB,sourceRows:input}),
    importSourceProductUnitsWithD1({DB,sourceRows:source()})
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(results.find(x=>x.status==='fulfilled').value,{
    sourceGroup:'PRODUCT_UNITS',importedRows:2,reconciled:true
  });
  assert.equal(JSON.stringify(input),unchanged);
  assert.equal(await count(),2);
  assert.deepEqual(await persisted(),[
    {legacy_sheet_row:2,unit_id:'UNT-SRC-001',unit_name:'Pcs',status:'Active',
      created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,unit_id:'UNT-SRC-002',unit_name:'গিরা',status:'Inactive',
      created_at:''}
  ]);
});

test('awaited legacy read + guarded source-id physical-row CAS update work on imported D1 rows',async()=>{
  const reader=createLegacyCatalogReadAdapter({DB});
  assert.deepEqual(await reader.getAllRows_('PRODUCT_UNITS'),source());
  const writer=createGuardedCatalogUpdateAdapter({DB});
  await writer.updateRowFields_('PRODUCT_UNITS',3,{'Unit Name':'গিরা ২'},{
    sourceId:'UNT-SRC-002',name:'গিরা',status:'Inactive'
  });
  assert.deepEqual((await reader.getAllRows_('PRODUCT_UNITS'))[1],{
    'Unit ID':'UNT-SRC-002','Unit Name':'গিরা ২',Status:'Inactive',
    'Created At':'',_rowIndex:3
  });
  await assert.rejects(()=>writer.updateRowFields_('PRODUCT_UNITS',3,{
    'Unit Name':'Forged'
  },{sourceId:'UNT-SRC-002',name:'গিরা',status:'Inactive'}),/stale|refused|precondition/i);
  assert.equal((await persisted())[1].unit_name,'গিরা ২');
});

test('replay or different snapshot fails SQL empty-target guard without changing imported rows',async()=>{
  const before=await persisted();
  await assert.rejects(()=>importSourceProductUnitsWithD1({DB,sourceRows:source()}),/D1|failed|import/i);
  const alternate=source();alternate[0]['Unit ID']='UNT-NEW-001';
  await assert.rejects(()=>importSourceProductUnitsWithD1({DB,sourceRows:alternate}),/D1|failed|import/i);
  assert.deepEqual(await persisted(),before);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM product_categories').first()).n,0);
});

test('offline D1 importer does not create any test HTTP or live RPC surface',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/import','/api/health']){
    const r=await worker.fetch('http://synthetic.local'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(r.status,404);
  }
  assert.equal(await count(),2);
});
