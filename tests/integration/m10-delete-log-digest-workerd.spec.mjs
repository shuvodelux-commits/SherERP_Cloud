import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceDeleteLogWithD1} from '../../src/db/delete-log-import.js';
import {summarizeM10DeleteLog} from '../../src/migration/m10-delete-log-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-delete-log-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-delete-log-import-local-only');
let DB;
const sample=()=>[
  {'Log ID':'DEL-001',Date:'2026-11-15',Time:'12:30',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-001','Deleted By Mobile':'01700000009',_rowIndex:2},
  {'Log ID':'DEL-002',Date:'2026-11-15',Time:'12:30',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-001','Deleted By Mobile':'01700000009',_rowIndex:3}
];
const digest=rows=>summarizeM10DeleteLog({inventory,rows});
async function readBack(){
  const res=await DB.prepare('SELECT legacy_sheet_row,log_id,date_text,time_text,module,record_id,invoice_no,reason,deleted_by,deleted_by_mobile FROM legacy_delete_log ORDER BY legacy_sheet_row ASC').all();
  assert.equal(res.success,true);
  assert.ok(Array.isArray(res.results));
  return res.results.map(r=>({
    'Log ID':r.log_id,Date:r.date_text,Time:r.time_text,Module:r.module,
    'Record ID':r.record_id,'Invoice No':r.invoice_no,Reason:r.reason,
    'Deleted By':r.deleted_by,'Deleted By Mobile':r.deleted_by_mobile,
    _rowIndex:r.legacy_sheet_row
  }));
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('M10 independent synthetic source and actual D1 readback produce matching DELETE_LOG ID and row digests',async()=>{
  const source=sample(),original=structuredClone(source);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM legacy_delete_log').first()).n,0);
  const result=await importSourceDeleteLogWithD1({DB,sourceRows:source});
  assert.deepEqual(result,{sourceGroup:'DELETE_LOG',importedRows:2,reconciled:true});
  const actual=await readBack();
  assert.notStrictEqual(actual,source);
  assert.deepEqual(actual,source);
  assert.deepEqual(digest(actual),digest(source));
  assert.deepEqual(source,original);
});

test('M02 D1 immutable triggers reject mutation and deletion without altering persisted audit history',async()=>{
  const before=digest(await readBack());
  await assert.rejects(()=>DB.prepare("UPDATE legacy_delete_log SET reason='forged' WHERE log_id='DEL-001'").run(),/immutable|audit|forbidden/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM legacy_delete_log WHERE log_id='DEL-001'").run(),/immutable|audit|forbidden/i);
  assert.deepEqual(digest(await readBack()),before);
  assert.equal((await readBack()).length,2);
});

test('independent readback copies detect content-only and original-ID-only corruption separately',async()=>{
  const observed=await readBack(),baseline=digest(observed);
  const copyWithReason=structuredClone(observed);
  copyWithReason[0].Reason='  changed reason  ';
  const content=digest(copyWithReason);
  assert.notEqual(content.rowDigest,baseline.rowDigest);
  assert.equal(content.idDigest,baseline.idDigest);
  const copyWithId=structuredClone(observed);
  copyWithId[1]['Log ID']='DEL-TAMPER';
  const changedId=digest(copyWithId);
  assert.notEqual(changedId.idDigest,baseline.idDigest);
  assert.notEqual(changedId.rowDigest,baseline.rowDigest);
  const shortened=digest(observed.slice(0,1));
  assert.notEqual(shortened.rowCount,baseline.rowCount);
  assert.notEqual(shortened.idDigest,baseline.idDigest);
});

test('existing local immutable audit history rejects changed snapshot replay',async()=>{
  const altered=sample();altered[0].Reason='replaced history';
  await assert.rejects(()=>importSourceDeleteLogWithD1({DB,sourceRows:altered}),/failed|target must be fresh/i);
  assert.deepEqual(await readBack(),sample());
});

test('local Worker exposes no public audit import, RPC or health route',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m10__/delete-log-snapshot']){
    const result=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(result.status,404);
  }
});
