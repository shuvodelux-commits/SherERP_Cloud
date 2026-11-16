import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {importSourceDeleteLogWithD1} from '../../src/db/delete-log-import.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-delete-log-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-delete-log-import-local-only');
let DB;
const sample=()=>[
  {'Log ID':'DEL-01',Date:'2026-11-15',Time:'12:30',Module:'SALES','Record ID':'INV-1',
    'Invoice No':'INV-1',Reason:'ভুল', 'Deleted By':'U-01','Deleted By Mobile':'01712345678',_rowIndex:2},
  {'Log ID':'DEL-02',Date:'2026-11-15',Time:'12:30',Module:'SALES','Record ID':'INV-1',
    'Invoice No':'INV-1',Reason:'ভুল', 'Deleted By':'U-01','Deleted By Mobile':'01712345678',_rowIndex:3}
];
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_delete_log').first()).n;
const read=async()=>(await DB.prepare('SELECT legacy_sheet_row,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile FROM legacy_delete_log ORDER BY legacy_sheet_row').all()).results;

before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});
test('invalid source never reaches real local D1',async()=>{
  const s=sample();
  for(const rows of [[],s.slice().reverse(),[{...s[0],'Deleted By Mobile':1712345678},s[1]],
    [s[0],{...s[1],'Log ID':'DEL-01'}]]){
    await assert.rejects(()=>importSourceDeleteLogWithD1({DB,sourceRows:rows}),/source|invalid|duplicate/i);
    assert.equal(await count(),0);
  }
});
test('late-row insert violation rolls back all audit history in actual D1 batch',async()=>{
  await DB.prepare("CREATE TRIGGER m02_delete_log_late_failure BEFORE INSERT ON legacy_delete_log WHEN NEW.log_id='DEL-02' BEGIN SELECT RAISE(ABORT,'late failure'); END").run();
  try{
    await assert.rejects(()=>importSourceDeleteLogWithD1({DB,sourceRows:sample()}),/D1|failed/i);
    assert.equal(await count(),0);
  }finally{await DB.prepare('DROP TRIGGER m02_delete_log_late_failure').run();}
});
test('concurrent import has one winner with exact source IDs, duplicate payloads and phone-leading zeros',async()=>{
  const input=sample(),original=JSON.stringify(input);
  const outcomes=await Promise.allSettled([
    importSourceDeleteLogWithD1({DB,sourceRows:input}),
    importSourceDeleteLogWithD1({DB,sourceRows:sample()})
  ]);
  assert.deepEqual(outcomes.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.deepEqual(outcomes.find(x=>x.status==='fulfilled').value,{sourceGroup:'DELETE_LOG',importedRows:2,reconciled:true});
  assert.equal(JSON.stringify(input),original);
  assert.deepEqual(await read(),[
    {legacy_sheet_row:2,log_id:'DEL-01',date_text:'2026-11-15',time_text:'12:30',module:'SALES',
      record_id:'INV-1',invoice_no:'INV-1',reason:'ভুল',deleted_by:'U-01',deleted_by_mobile:'01712345678'},
    {legacy_sheet_row:3,log_id:'DEL-02',date_text:'2026-11-15',time_text:'12:30',module:'SALES',
      record_id:'INV-1',invoice_no:'INV-1',reason:'ভুল',deleted_by:'U-01',deleted_by_mobile:'01712345678'}
  ]);
});
test('replay and changed source cannot rewrite immutable audit history',async()=>{
  const before=await read();
  await assert.rejects(()=>importSourceDeleteLogWithD1({DB,sourceRows:sample()}),/D1|failed/i);
  const changed=sample();changed[0].Reason='replacement';
  await assert.rejects(()=>importSourceDeleteLogWithD1({DB,sourceRows:changed}),/D1|failed/i);
  await assert.rejects(()=>DB.prepare("UPDATE legacy_delete_log SET reason='forged' WHERE log_id='DEL-01'").run(),/immutable|audit|forbidden/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM legacy_delete_log WHERE log_id='DEL-01'").run(),/immutable|audit|forbidden/i);
  assert.deepEqual(await read(),before);
});
test('nonempty D1 target aborts replay before any untrusted readback layer is accessed',async()=>{
  // Inject a misleading reader. Existing audit rows must reject replay before
  // any readback is consulted, preserving the immutable audit history.
  const realPrepare=DB.prepare.bind(DB);
  const facade={
    prepare(sql){
      if(sql.startsWith('SELECT legacy_sheet_row,log_id,date_text'))return {
        bind(...args){const statement=realPrepare(sql).bind(...args);return {async all(){
          const result=await statement.all();
          result.results[0].reason='corrupted response';
          return result;
        }};}
      };
      return realPrepare(sql);
    },
    batch:DB.batch.bind(DB)
  };
  // Existing target is already nonempty: prove that the safety guard takes
  // precedence; the importer must never read back a changed replay.
  await assert.rejects(()=>importSourceDeleteLogWithD1({DB:facade,sourceRows:sample()}),/D1|failed/i);
  assert.equal(await count(),2);
});
test('synthetic Worker has no reachable importer or public RPC',async()=>{
  for(const path of ['/api/rpc','/__m02_test__/delete-log-import','/api/health']){
    const res=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(res.status,404);
  }
});
