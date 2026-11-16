import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceLegacyErrorLogsWithD1}
  from '../../src/db/legacy-error-log-import.js';
import {createLegacyErrorLogReadAdapter}
  from '../../src/db/legacy-error-log-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-legacy-logs-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-legacy-logs-local-only');
const source=()=>[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা বার্তা  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা বার্তা  ',_rowIndex:3},
  {Timestamp:'',Context:'Reports',Message:'empty original timestamp',_rowIndex:4}
];
let DB;
const reader=()=>createLegacyErrorLogReadAdapter({DB});
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_error_logs').first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceLegacyErrorLogsWithD1({DB,sourceRows:source()}),
    {sourceGroup:'LOGS',importedRows:3,reconciled:true});
});
after(async()=>harness.close());

test('real Workerd D1 source import→LOGS reader retains duplicate identical events and row positions',async()=>{
  const a=reader();
  assert.deepEqual(await a.getSheetHeaders_('LOGS'),['Timestamp','Context','Message']);
  const rows=await a.getAllRows_('LOGS');
  assert.deepEqual(rows,source());
  assert.equal(rows[0].Message,'  বাংলা বার্তা  ');
  assert.equal(rows[2].Timestamp,'');
  assert.deepEqual(rows.map(x=>x._rowIndex),[2,3,4]);
  assert(rows.every(x=>!Object.hasOwn(x,'Log ID')&&!Object.hasOwn(x,'row_id')));
  assert.equal(await count(),3);
});

test('real D1 exact find helpers preserve all identical source error events',async()=>{
  const a=reader();
  assert.deepEqual(await a.findRows_('LOGS','Context','POS'),source().slice(0,2));
  assert.deepEqual(await a.findFirstRow_('LOGS','Message','  বাংলা বার্তা  '),source()[0]);
  assert.deepEqual(await a.findRow_('LOGS','Timestamp',''),{row:source()[2],rowIndex:4});
  assert.equal(await a.findRowIndex_('LOGS','Context','Reports'),4);
  assert.equal(await a.findRowIndex_('LOGS','Context','missing'),-1);
  assert.equal(await a.findFirstRow_('LOGS','Message','বাংলা বার্তা'),null);
  await assert.rejects(()=>a.findRows_('LOGS','row_id',1),/column|header|unsupported/i);
});

test('private M03 reader performs no mutations and fails closed on broken physical source rows',async()=>{
  const before=(await DB.prepare(
    'SELECT row_id,legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row'
  ).all()).results;
  await reader().getAllRows_('LOGS');
  await reader().findRows_('LOGS','Context','POS');
  const after=(await DB.prepare(
    'SELECT row_id,legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row'
  ).all()).results;
  assert.deepEqual(after,before);
  await DB.prepare('INSERT INTO legacy_error_logs(legacy_sheet_row,timestamp_text,context,message) VALUES(?,?,?,?)')
    .bind(8,'','synthetic gap','test only').run();
  await assert.rejects(()=>reader().getAllRows_('LOGS'),/invalid|source|row|physical/i);
  assert.equal(await count(),4);
});

test('both local fixture and public Worker keep private LOGS source data inaccessible',async()=>{
  for(const path of ['/api/rpc','/__m03_test__/logs-read','/api/health']){
    const response=await worker.fetch('http://local-only.test'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
  const response=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['LOGS']})
  }),{DB});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{success:false,message:'RPC method not migrated'});
  const preview=JSON.parse(readFileSync(new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8').includes('legacy-error-log-read'),false);
  assert.equal(readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8').includes("'LOGS'"),false);
});
