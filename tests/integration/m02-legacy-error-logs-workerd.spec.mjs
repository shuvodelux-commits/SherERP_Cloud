import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceLegacyErrorLogsWithD1} from '../../src/db/legacy-error-log-import.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-legacy-logs-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-legacy-logs-local-only');
let DB;
const source=()=>[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:3},
  {Timestamp:'',Context:'Report',Message:'legacy blank time',_rowIndex:4}
];
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_error_logs').first()).n;
const saved=async()=>(await DB.prepare('SELECT legacy_sheet_row,timestamp_text,context,message FROM legacy_error_logs ORDER BY legacy_sheet_row').all()).results;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('source preflight refuses bad shape without any local D1 write',async()=>{
  const input=source();
  for(const rows of [[],[input[1],input[0],input[2]],[input[0],{...input[1],_rowIndex:4},input[2]],
    [{...input[0],Hidden:'secret'},input[1],input[2]]]){
    await assert.rejects(()=>importSourceLegacyErrorLogsWithD1({DB,sourceRows:rows}),/source|invalid/i);
    assert.equal(await count(),0);
  }
});

test('later-row D1 failure rolls back all historical log entries',async()=>{
  await DB.prepare("CREATE TRIGGER m02_log_late_fail BEFORE INSERT ON legacy_error_logs WHEN NEW.legacy_sheet_row=3 BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END").run();
  try{
    await assert.rejects(()=>importSourceLegacyErrorLogsWithD1({DB,sourceRows:source()}),/D1|failed/i);
    assert.equal(await count(),0);
  }finally{await DB.prepare('DROP TRIGGER m02_log_late_fail').run();}
});

test('concurrent import produces one winner and exactly preserves duplicate messages and row provenance',async()=>{
  const input=source(),before=JSON.stringify(input);
  const pair=await Promise.allSettled([
    importSourceLegacyErrorLogsWithD1({DB,sourceRows:input}),
    importSourceLegacyErrorLogsWithD1({DB,sourceRows:source()})
  ]);
  assert.deepEqual(pair.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(pair.find(x=>x.status==='fulfilled').value,{
    sourceGroup:'LOGS',importedRows:3,reconciled:true
  });
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(await saved(),[
    {legacy_sheet_row:2,timestamp_text:'2026-11-15T09:00:00.000Z',context:'POS',message:'  বাংলা 오류  '},
    {legacy_sheet_row:3,timestamp_text:'2026-11-15T09:00:00.000Z',context:'POS',message:'  বাংলা 오류  '},
    {legacy_sheet_row:4,timestamp_text:'',context:'Report',message:'legacy blank time'}
  ]);
});

test('existing logs reject replay and changed snapshot without altering D1',async()=>{
  const before=await saved();
  await assert.rejects(()=>importSourceLegacyErrorLogsWithD1({DB,sourceRows:source()}),/D1|failed/i);
  const altered=source();altered[1].Message='changed';
  await assert.rejects(()=>importSourceLegacyErrorLogsWithD1({DB,sourceRows:altered}),/D1|failed/i);
  assert.deepEqual(await saved(),before);
});

test('postcommit tamper is flagged NEEDS_REVIEW instead of claiming rollback',async()=>{
  await DB.prepare('DELETE FROM legacy_error_logs').run();
  await DB.prepare("CREATE TRIGGER m02_log_readback_change AFTER INSERT ON legacy_error_logs WHEN NEW.legacy_sheet_row=3 BEGIN UPDATE legacy_error_logs SET message='tampered' WHERE legacy_sheet_row=3; END").run();
  try{
    await assert.rejects(()=>importSourceLegacyErrorLogsWithD1({DB,sourceRows:source()}),/NEEDS_REVIEW/);
    assert.equal(await count(),3);
  }finally{await DB.prepare('DROP TRIGGER m02_log_readback_change').run();}
});

test('local fixture has no reachable import API or RPC',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m02_test__/logs-import']){
    const reply=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(reply.status,404);
  }
});
