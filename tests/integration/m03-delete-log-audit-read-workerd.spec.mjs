import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceDeleteLogWithD1} from '../../src/db/delete-log-import.js';
import {createDeleteLogAuditReadAdapter} from '../../src/db/delete-log-audit-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-delete-log-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-delete-log-import-local-only');
const source=()=>[
  {'Log ID':'DEL-1',Date:'2026-11-16',Time:'09:05',Module:'SALES','Record ID':'INV-12',
    'Invoice No':'INV-12',Reason:'  ভুল সংশোধন  ', 'Deleted By':'মিনা',
    'Deleted By Mobile':'01700123456',_rowIndex:2},
  {'Log ID':'DEL-2',Date:'2026-11-16',Time:'09:05',Module:'SALES','Record ID':'INV-12',
    'Invoice No':'INV-12',Reason:'  ভুল সংশোধন  ', 'Deleted By':'মিনা',
    'Deleted By Mobile':'01700123456',_rowIndex:3}
];
let DB;
const count=async()=> (await DB.prepare('SELECT COUNT(*) AS n FROM legacy_delete_log').first()).n;
const adapter=()=>createDeleteLogAuditReadAdapter({DB});
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceDeleteLogWithD1({DB,sourceRows:source()}),
    {sourceGroup:'DELETE_LOG',importedRows:2,reconciled:true});
});
after(async()=>harness.close());

test('real Workerd/D1 M02 immutable import gives source-shaped DELETE_LOG rows in physical order',async()=>{
  const a=adapter();
  assert.deepEqual(await a.getSheetHeaders_('DELETE_LOG'),
    ['Log ID','Date','Time','Module','Record ID','Invoice No','Reason','Deleted By','Deleted By Mobile']);
  assert.deepEqual(await a.getAllRows_('DELETE_LOG'),source());
  assert.equal((await a.getAllRows_('DELETE_LOG'))[0]['Deleted By Mobile'],'01700123456');
  assert.equal((await a.getAllRows_('DELETE_LOG'))[0].Reason,'  ভুল সংশোধন  ');
  assert.equal(await count(),2);
});

test('source lookup preserves duplicate Record IDs and exact Log ID physical row semantics',async()=>{
  const a=adapter();
  assert.deepEqual(await a.findRows_('DELETE_LOG','Record ID','INV-12'),source());
  assert.deepEqual(await a.findFirstRow_('DELETE_LOG','Invoice No','INV-12'),source()[0]);
  assert.deepEqual(await a.findRow_('DELETE_LOG','Log ID','DEL-2'),{row:source()[1],rowIndex:3});
  assert.equal(await a.findRowIndex_('DELETE_LOG','Log ID','DEL-2'),3);
  assert.equal(await a.findRowIndex_('DELETE_LOG','Log ID','unknown'),-1);
  assert.equal(await a.findFirstRow_('DELETE_LOG','Reason','ভুল সংশোধন'),null);
});

test('M03 audit reader writes nothing and M02 D1 triggers preserve immutable original deletion evidence',async()=>{
  const before=(await DB.prepare('SELECT * FROM legacy_delete_log ORDER BY legacy_sheet_row').all()).results;
  await adapter().getAllRows_('DELETE_LOG');
  await adapter().findRows_('DELETE_LOG','Log ID','DEL-1');
  const after=(await DB.prepare('SELECT * FROM legacy_delete_log ORDER BY legacy_sheet_row').all()).results;
  assert.deepEqual(after,before);
  await assert.rejects(()=>DB.prepare(
    "UPDATE legacy_delete_log SET reason='overwrite' WHERE log_id='DEL-1'"
  ).run(),/immutable|audit|forbidden/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM legacy_delete_log WHERE log_id='DEL-1'"
  ).run(),/immutable|audit|forbidden/i);
  assert.equal(await count(),2);
});

test('public Worker 501 and isolated Worker 404 prevent DELETE_LOG actor/phone disclosure',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m03_test__/delete-log-audit-read']){
    const r=await worker.fetch('http://local-only.test'+path,{
      method:'POST',body:'{}',headers:{'Content-Type':'application/json'}
    });
    assert.equal(r.status,404);
  }
  const response=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['DELETE_LOG']})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')
    .includes('delete-log-audit-read'),false);
  assert.equal(readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8')
    .includes('DELETE_LOG'),false);
});

test('synthetic gap in immutable D1 rejects whole source read before any wrong row-index mapping',async()=>{
  await DB.prepare('INSERT INTO legacy_delete_log(legacy_sheet_row,log_id) VALUES(?,?)')
    .bind(8,'DEL-GAP').run();
  await assert.rejects(()=>adapter().getAllRows_('DELETE_LOG'),/source|physical|row|archive/i);
  await assert.rejects(()=>adapter().findRowIndex_('DELETE_LOG','Log ID','DEL-1'),/source|physical|row|archive/i);
  assert.equal(await count(),3);
});
